import { Context, InputFile } from "grammy";
import { openai } from "../../core/openai";
import sharp from "sharp";
import axios from "axios";
import fs from "fs";
import path from "path";
import { InputMediaPhoto } from "grammy/types";

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

async function generateImagesForMeditation(steps: Step[]) {
    const imagesWithText: { imagePath: string; text: string }[] = [];
    console.log(imagesWithText, "imagesWithText");

    for (const step of steps) {
        try {
            const prompt = `NAD+ boosts cellular energy, enhancing your meditation experience.`;
            const response = await openai.images.generate({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1792",
            });

            if (response.data[0].url) {
                const imagePath = response.data[0].url;
                const text = `${step.details}`;
                const processedImage = await addTextOnImage({ imagePath, text, step: step.step });
                if (processedImage) {
                    imagesWithText.push({ imagePath: processedImage.outputPath, text });
                }
            }
        } catch (error) {
            console.error("Error generating image:", error);
            // Используем запасное изображение
            // const text = `${step.details}`;
            // const processedImage = await addTextOnImage({ imagePath: fallbackImagePath, text });
            // if (processedImage) {
            //     imagesWithText.push({ imagePath: processedImage.outputPath, text });
            // }
        }
    }
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

const nad = async (ctx: Context): Promise<void> => {
    try {
        await ctx.replyWithChatAction("typing");
        if (!ctx.from) throw new Error("User not found");
        const meditationSteps = await getMeditationSteps();
        console.log(meditationSteps, "meditationSteps");
        const images = await generateImagesForMeditation(meditationSteps.activities[0].steps);
        console.log(images, "images");

        if (images.length === 0) throw new Error("No images found");
        const mediaGroup: InputMediaPhoto[] = images.map((image) => ({
            type: "photo",
            media: new InputFile(image.imagePath),
            caption: image.text,
        }));

        await ctx.replyWithMediaGroup(mediaGroup);
    } catch (error) {
        throw error;
    }
};

export default nad;
