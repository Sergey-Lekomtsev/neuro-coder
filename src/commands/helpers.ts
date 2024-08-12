import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import axios from "axios";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import path from "path";
import { openai } from "../core/openai";
import { Step } from "../utils/types";
import Replicate from "replicate";
import { promises as fs } from "fs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function createSlideshow(images: string[], audioPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    images.forEach((image, index) => {
      console.log(`Adding image ${index + 1}: ${image}`);
      command.input(image).loop(1).duration(10);
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

export function createSVGWithHighlightedText(width: number, height: number, text: string) {
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
    let buffer: Buffer;

    try {
      console.log(`Попытка загрузки изображения для шага ${step}: ${imagePath}`);
      const response = await axios.get(imagePath, {
        responseType: "arraybuffer",
        timeout: 15000, // Увеличим таймаут до 15 секунд
      });
      buffer = Buffer.from(response.data, "binary");
      console.log(`Изображение успешно загружено для шага ${step}`);
    } catch (downloadError: any) {
      console.error(`Ошибка загрузки изображения для шага ${step}:`, downloadError.message);
      if (downloadError.response) {
        console.error(`Статус ответа: ${downloadError.response.status}`);
        console.error(`Заголовки ответа:`, downloadError.response.headers);
      }
      throw downloadError;
    }

    const width = 1024;
    const height = 1792;

    const svgImage = createSVGWithHighlightedText(width, height, text);
    const svgBuffer = Buffer.from(svgImage);

    const outputFileName = `src/images/slide-${step}.png`;
    const outputPath = path.join(process.cwd(), outputFileName);

    const image = await sharp(buffer)
      .resize(width, height, { fit: "cover", position: "center" })
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
  } catch (error: any) {
    console.error(`Ошибка в addTextOnImage для шага ${step}:`, error.message);
    throw error;
  }
}
export async function generateImagesForMeditation(steps: Step[]) {
  const imagesWithText: { imagePath: string; text: string }[] = [];
  console.log("Начинаем генерацию изображений для медитации");

  for (const step of steps) {
    try {
      const prompt = `Boosts cellular energy, enhancing your meditation experience. photorealism, bohemian style, pink and blue pastel color, hyper-realistic`;

      const isModelFlux = true;
      const model = isModelFlux
        ? "black-forest-labs/flux-pro"
        : "stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf";
      const input = {
        prompt,
        negative_prompt: "nsfw, erotic, violence, people, animals",
        guidance_scale: 7.5,
        num_inference_steps: 50,
        aspect_ratio: "9:16",
      };

      let retries = 11;
      let output;

      while (retries > 0) {
        try {
          console.log(`Попытка генерации изображения для шага ${step.step} (осталось попыток: ${retries})`);
          output = await replicate.run(model, { input });
          console.log(output, "✅ выход output");
          if (output && output[0]) {
            console.log(`Изображение успешно сгенерировано для шага ${step.step}`);
            break;
          }
        } catch (error: any) {
          console.error(`Ошибка при генерации изображения для шага ${step.step}:`, error.message);
          retries--;
          if (retries === 0) {
            throw error;
          }
        }
      }

      if (output) {
        const imagePath = output;
        console.log(imagePath, "imagePath");
        const text = `${step.details}`;
        console.log(text, "text");
        try {
          const processedImage = await addTextOnImage({ imagePath, text, step: step.step });
          console.log(processedImage, "processedImage");
          if (processedImage) {
            imagesWithText.push({ imagePath: processedImage.outputPath, text });
            console.log(`Изображение успешно обработано и сохранено для шага ${step.step}`);
          }
        } catch (error: any) {
          console.error(`Ошибка при обработке изображения для шага ${step.step}:`, error.message);
          throw error; // Перебрасываем ошибку, чтобы использовать запасное изображение
        }
      } else {
        throw new Error(`Не удалось сгенерировать изображение для шага ${step.step}`);
      }
    } catch (error: any) {
      console.error(`Ошибка при работе с шагом ${step.step}:`, error.message);
      // Используем запасное изображение только если не удалось сгенерировать или обработать изображение
      // const fallbackImagePath = path.join(process.cwd(), "src/assets/fallback-image.jpg");
      // const text = `${step.details}`;
      // try {
      //   const processedImage = await addTextOnImage({ imagePath: fallbackImagePath, text, step: step.step });
      //   if (processedImage) {
      //     imagesWithText.push({ imagePath: processedImage.outputPath, text });
      //     console.log(`Использовано запасное изображение для шага ${step.step}`);
      //   }
      // } catch (fallbackError: any) {
      //   console.error(`Ошибка при использовании запасного изображения для шага ${step.step}:`, fallbackError.message);
      // }
    }
  }

  console.log(`Генерация изображений завершена. Всего изображений: ${imagesWithText.length}`);
  return imagesWithText;
}

// export async function generateImagesForMeditation(steps: Step[]) {
//   const imagesWithText: { imagePath: string; text: string }[] = [];
//   console.log(imagesWithText, "imagesWithText");

//   for (const step of steps) {
//     try {
//       const prompt = `Boosts cellular energy, enhancing your meditation experience. photorealism, bohemian style, pink and blue pastel color, hyper-realistic`;

//       //"stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf";

//       const input = {
//         prompt,
//         aspect_ratio: "9:16",
//         negative_prompt: "nsfw, erotic, violence, people, animals",
//       };
//       const output = await replicate.run(model, { input });
//       console.log(output, "output");
//       if (output) {
//         const imagePath = output.toString();
//         const text = `${step.details}`;

//         const processedImage = await addTextOnImage({ imagePath, text, step: step.step });
//         if (processedImage) {
//           imagesWithText.push({ imagePath: processedImage.outputPath, text });
//         }
//       }
//     } catch (error) {
//       console.error("Error generating image:", error);
//       // Используем запасное изображение
//       // const text = `${step.details}`;
//       // const processedImage = await addTextOnImage({ imagePath: fallbackImagePath, text });
//       // if (processedImage) {
//       //     imagesWithText.push({ imagePath: processedImage.outputPath, text });
//       // }
//     }
//   }
//   return imagesWithText;
// }

// export async function generateImagesForMeditation(steps: Step[]) {
//   const imagesWithText: { imagePath: string; text: string }[] = [];
//   console.log(imagesWithText, "imagesWithText");

//   for (const step of steps) {
//     try {
//       const prompt = `Boosts cellular energy, enhancing your meditation experience. photorealism, bohemian style, pink and blue pastel color, hyper-realistic`;

//       const response = await openai.images.generate({
//         model: "dall-e-3",
//         prompt: prompt,
//         n: 1,
//         size: "1024x1792",
//       });

//       if (response.data[0].url) {
//         const imagePath = response.data[0].url;
//         const text = `${step.details}`;
//         const processedImage = await addTextOnImage({ imagePath, text, step: step.step });
//         if (processedImage) {
//           imagesWithText.push({ imagePath: processedImage.outputPath, text });
//         }
//       }
//     } catch (error) {
//       console.error("Error generating image:", error);
//       // Используем запасное изображение
//       // const text = `${step.details}`;
//       // const processedImage = await addTextOnImage({ imagePath: fallbackImagePath, text });
//       // if (processedImage) {
//       //     imagesWithText.push({ imagePath: processedImage.outputPath, text });
//       // }
//     }
//   }
//   return imagesWithText;
// }

export async function getMeditationSteps({ prompt }: { prompt: string }) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that creates meditation steps with NAD+ supplement integration.",
        },
        {
          role: "user",
          content: prompt,
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
