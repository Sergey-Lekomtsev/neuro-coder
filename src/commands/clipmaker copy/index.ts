import { Context, InputFile } from "grammy";
import { openai } from "../../core/openai";
import sharp from "sharp";
import axios from "axios";
import { InputMediaPhoto } from "grammy/types";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import * as fal from "@fal-ai/serverless-client";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

if (!process.env.FAL_KEY) {
  throw new Error("FAL_KEY is not set");
}
fal.config({
  credentials: process.env.FAL_KEY,
});

async function createSlideshow(images: string[], audioPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    images.forEach((image, index) => {
      console.log(`Adding image ${index + 1}: ${image}`);
      command.input(image).loop(1).duration(8);
    });

    // // Добавляем аудио файл
    command.input(audioPath);

    let filterComplex = "";
    let overlayChain = "";

    images.forEach((_, index) => {
      if (index === 0) {
        overlayChain = "[0]";
      } else {
        filterComplex += `[${index}]fade=d=1:t=in:alpha=1,setpts=PTS-STARTPTS+${index * 2}/TB[f${index - 1}]; `;
        overlayChain += `[f${index - 1}]overlay`;
        if (index < images.length - 1) {
          overlayChain += `[bg${index}];[bg${index}]`;
        }
      }
    });

    // Добавляем crop фильтр для обрезки видео до 480x480 с центрированием
    filterComplex += `${overlayChain},crop=1024:1792:in_w/2-240:in_h/2-240,format=yuv420p[v]`;

    command
      .outputOptions("-filter_complex", filterComplex)
      .outputOptions("-map", "[v]")
      .outputOptions("-map", `${images.length}:a`) // Мапим аудио из последнего входного файла
      .outputOptions("-c:a", "aac") // Кодируем аудио в AAC
      .outputOptions("-shortest") // Обрезаем видео до длины самого короткого входного потока
      .outputOptions("-r", "25")
      .output(outputPath)
      .on("start", (commandLine) => {
        console.log("FFmpeg process started:", commandLine);
      })
      .on("progress", (progress) => {
        console.log("Processing: " + progress.percent + "% done");
      })
      .on("end", () => {
        console.log("FFmpeg process completed");
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        reject(err);
      })
      .run();
  });
}
function createSVGWithHighlightedText(width: number, height: number, text: string) {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  const maxWidth = width * 0.9; // 90% от ширины SVG
  const fontSize = 70;
  const lineHeight = 80;
  const paddingX = 10; // Горизонтальный отступ
  const paddingY = 10; // Вертикальный отступ

  // Функция для измерения ширины текста (приблизительно)
  function getTextWidth(text: string): number {
    return text.length * (fontSize * 0.6); // Приблизительный расчет
  }

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (getTextWidth(testLine) <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine) {
    lines.push(currentLine);
  }

  const startY = (height - lines.length * lineHeight) / 2;

  const textElements = lines
    .map((line, index) => {
      const lineWidth = getTextWidth(line);
      const rectX = (width - lineWidth) / 2 - paddingX;
      const rectY = startY + index * lineHeight - paddingY / 2;
      return `
      <g transform="translate(0, ${startY + index * lineHeight})">
        <rect x="${rectX + 10}" y="${-lineHeight / 2 - 25}" width="${lineWidth + paddingX * 2}" height="${lineHeight}" fill="#ffffff70" rx="10" ry="10"/>
        <text x="50%" y="0" text-anchor="middle" dominant-baseline="middle" class="title">${line}</text>
      </g>
    `;
    })
    .join("");

  return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@700&amp;display=swap');
          .title { 
            font-family: 'Roboto', sans-serif;
            fill: #000000; 
            font-size: ${fontSize}px; 
            font-weight: 700;
          }
        </style>
        ${textElements}
      </svg>
    `;
}
export async function addTextOnImage({ imagePath, text, step }: { imagePath: string; text: string; step: string }) {
  try {
    // Download the image
    const response = await axios.get(imagePath, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    const width = 1024;
    const height = 1792;

    const svgImage = createSVGWithHighlightedText(width, height, text);
    const svgBuffer = Buffer.from(svgImage);

    const outputFileName = `src/images/slide-${step}.png`;
    const outputPath = path.join(process.cwd(), outputFileName);

    const image = await sharp(buffer)
      .composite([
        {
          input: svgBuffer,
          top: 0,
          left: 0,
        },
      ])
      .toFile(outputPath);
    console.log(`Изображение сохранено: ${outputPath}`);
    return { image, outputPath };
  } catch (error) {
    console.log(error);
  }
}

interface Step {
  step: string;
  details: string;
}

interface FalResult {
  images?: Array<{
    url: string;
  }>;
}

async function generateImagesForMeditation(steps: Step[]) {
  const imagesWithText: { imagePath: string; text: string }[] = [];
  console.log("Starting image generation...");

  for (const step of steps) {
    try {
      const prompt = `NAD + boosts cellular energy, enhancing your meditation experience. photorealistic style, bohemian style, pink and blue pastel color, photo real, hyper-realistic. ${step.details}`;

      const result = (await fal.subscribe("fal-ai/flux/dev", {
        input: {
          prompt: prompt,
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            update.logs.map((log) => log.message).forEach(console.log);
          }
        },
      })) as FalResult;

      if (result.images && result.images.length > 0) {
        const imageUrl = result.images[0].url;
        const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(response.data, "binary");

        const outputFileName = `slide-${step.step}.png`;
        const outputPath = path.join(process.cwd(), "src", "images", outputFileName);
        await fs.writeFile(outputPath, buffer);

        console.log(`Image saved successfully: ${outputPath}`);
        imagesWithText.push({ imagePath: outputPath, text: step.details });
      } else {
        console.log(`Failed to generate image for step: ${step.step}`);
      }
    } catch (error) {
      console.error(`Error generating image for step ${step.step}:`, error);
    }
  }

  console.log(`Generated ${imagesWithText.length} images`);
  return imagesWithText;
}

async function getMeditationSteps() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // или "gpt-4", если у вас есть доступ
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that creates meditation steps with NAD+ supplement integration.",
        },
        {
          role: "user",
          content: `Create 4 coherent steps with very short one-sentence abstracts on the topic of meditation with the addition of selling NAD+ supplements, where the third step must mention NAD+. Answer in json format. The structure should be as follows:
  
            {
              "activities": [
                {
                  "activity": "Meditation for Inner Peace",
                  "description": "A journey to tranquility and cellular rejuvenation.",
                  "steps": [
                    {
                      "step": "Step 1",
                      "details": "One-sentence description of step 1."
                    },
                    {
                      "step": "Step 2",
                      "details": "One-sentence description of step 2."
                    },
                    {
                      "step": "Step 3",
                      "details": "One-sentence description mentioning NAD+."
                    },
                    {
                      "step": "Step 4",
                      "details": "One-sentence description of step 4."
                    }
                  ]
                }
              ]
            }
  
            Ensure that the steps are coherent and flow logically from one to the next, incorporating the NAD+ supplement naturally into the meditation process.`,
        },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (content === null) {
      throw new Error("Received null content from OpenAI");
    }

    console.log(content);
    return JSON.parse(content);
  } catch (error) {
    console.error("Error:", error);
    throw error; // Перебрасываем ошибку, чтобы она могла быть обработана выше
  }
}

const clipmaker = async (ctx: Context): Promise<void> => {
  try {
    // Отправляем уведомление пользователю, что бот печатает
    await ctx.replyWithChatAction("typing");

    // Проверяем, есть ли информация о пользователе
    if (!ctx.from) throw new Error("User not found");

    // Получаем шаги медитации
    const meditationSteps = await getMeditationSteps();
    console.log(meditationSteps, "meditationSteps");

    // Генерируем изображения для шагов медитации
    const images = await generateImagesForMeditation(meditationSteps.activities[0].steps);
    console.log(images, "images");

    // Проверяем, были ли сгенерированы изображения
    if (images.length === 0) throw new Error("No images found");

    // Создаем группу медиа для отправки изображений
    const mediaGroup: InputMediaPhoto[] = images.map((image) => ({
      type: "photo",
      media: new InputFile(image.imagePath),
      caption: image.text,
    }));

    // Отправляем группу изображений пользователю
    await ctx.replyWithMediaGroup(mediaGroup);

    // Получаем пути к изображениям
    const imagePaths = images.map((img) => img.imagePath);
    // Определяем путь для выходного видеофайла
    const outputPath = path.join(process.cwd(), "src", "images", "slideshow.mp4");

    // Создаем слайд-шоу из изображений
    await createSlideshow(imagePaths, "src/audio/audio.mp3", outputPath);
    // Ждем 1 секунду после создания слайд-шоу
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Отправляем видео пользователю
    await ctx.replyWithVideo(new InputFile(outputPath), {
      caption: "Video meditation",
    });

    // Удаляем временные файлы
    await fs.unlink(outputPath);
    for (const image of images) {
      await fs.unlink(image.imagePath);
    }
  } catch (error) {
    // В случае ошибки, пробрасываем её дальше
    throw error;
  }
};

export default clipmaker;

// async function testSlideshow() {
//     const imageDir = path.join(process.cwd(), "src", "images");
//     const images = [
//         path.join(imageDir, "slide-Step 1.png"),
//         path.join(imageDir, "slide-Step 2.png"),
//         path.join(imageDir, "slide-Step 3.png"),
//         path.join(imageDir, "slide-Step 4.png"),
//     ];
//     const outputPath = path.join(imageDir, "test-slideshow.mp4");

//     try {
//         console.log("Starting slideshow creation...");
//         await createSlideshow(images, outputPath);
//         console.log(`Slideshow created successfully at: ${outputPath}`);
//     } catch (error) {
//         console.error("Error creating slideshow:", error);
//     }
// }

// testSlideshow();
