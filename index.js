import express from 'express';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

// 加载 .env 文件中的环境变量
dotenv.config();

const apiUrl = process.env.API_URL;
const model = process.env.MODEL;
const app = express();

// 解析 JSON 请求体
app.use(express.json());

app.post('/hanyuxinjie', async (req, res) => {
    const { text, apiKey } = req.body;

    if (!text || !apiKey || !model) {
        return res.status(400).json({ error: 'Missing required fields: text, apiKey, or model' });
    }

    try {
        // 发送请求到外部 API
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey
            },
            body: JSON.stringify({
                "model": model,
                "stream": true,
                "messages": [
                    {
                        "role": "user",
                        "content": `### 角色：
                                    你是新汉语老师，你年轻, 批判现实, 思考深刻, 语言风趣。你的行文风格和"Oscar Wilde"、"鲁迅"、"林语堂"、"Elon Reeve Musk"等大师高度一致，你擅长一针见血的表达隐喻，对现实的批判讽刺幽默。
                                    
                                    ## 基本信息
                                    - 作者：云中江树，李继刚
                                    - 重写：熊猫 Jay
                                    - 版本：v0.3
                                    
                                    ## 输出结果的字段解释
                                    1. interpretation : 将汉语词汇进行全新角度的解释，你会用一个特殊视角来解释一个词汇：
                                    用一句话表达你的词汇解释，抓住用户输入词汇的本质，使用辛辣的讽刺、一针见血地指出本质，使用包含隐喻的金句。
                                    例如："委婉"："刺向他人时, 决定在剑刃上撒上止痛药。" 注意输出结果使用类似现代诗排版的 HTML 的 <p> 标签，换行使用 <br> 标签。
                                    2. word: 词汇原文
                                    3. spell: 词汇原文的拼音
                                    4. english: 词汇原文的英文翻译
                                    5. japanese: 词汇原文的日文翻译
                                    6. summary: 词汇原文的精简，严格遵守一定不能超过 2 个字
                                    
                                    ## 输出格式
                                    {
                                        "interpretation": "xxxx",
                                        "word": "xxxx",
                                        "spell": "xxxx",
                                        "english": "xxxx",
                                        "japanese": "xxxxx",
                                        "summary": "xxxxx"
                                    }
                                    
                                    ## 任务：
                                    分析词汇 \`\`\`${text}\`\`\`，根据<输出结果的字段解释>中每个属性的定义来输出对应的类型，并按照<输出格式>输出 JSON 格式，注意只输出 JSON，不输出任何其他内容。`
                    }
                ],
                "type": "retrieval"
            })
        });

        // 读取并处理返回的数据流
        const reader = apiResponse.body; // Node.js中的Readable流
        let result = '';

        const textDecoder = new TextDecoder();
        for await (const chunk of reader) {
            // 将buffer转换为字符串
            const decodedValue = textDecoder.decode(chunk, { stream: true });
            const lines = decodedValue.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    if (line.includes('[DONE]')) break;
                    try {
                        const jsonData = JSON.parse(line.substring(6));
                        if (jsonData.choices && jsonData.choices[0] && jsonData.choices[0].delta) {
                            if (jsonData.choices[0].delta.content) {
                                result += jsonData.choices[0].delta.content;
                            }
                            if (jsonData.choices[0].finish_reason === 'stop') break;
                        }
                    } catch (error) {
                        console.error('Error parsing JSON:', error);
                    }
                }
            }
        }

        console.log('Result:', result);

        // 模板加载和处理
        const templates = await loadTemplates();
        let html = await fetchTemplate(result, templates);

        // 生成图片并转换为 Base64
        const base64Image = await generateImage(html);

        // 返回 Base64 图片
        res.json({ image: base64Image });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error generating image' });
    }
});

// 加载模板的函数
export async function loadTemplates() {
    // 获取本地 JSON 文件的路径
    const filePath = join(process.cwd(), 'template', 'template.json');

    try {
        // 读取文件并解析 JSON
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('加载模板时出错:', error);
        return null;
    }
}

// 解析模板并生成 HTML 的函数
async function fetchTemplate(result, templates) {
    let randomNumber = Math.floor(Math.random() * 10) + 1;
    const template = templates[randomNumber];

    // 移除可能的 Markdown ``` 包裹符号
    result = result.trim();
    if (result.startsWith('```json') && result.endsWith('```')) {
        result = result.slice(7, -3).trim();
    }
    result = result.replaceAll("<<","<");

    let data;
    try {
        data = JSON.parse(result);
    } catch (error) {
        console.error('无法解析 JSON 结果:', error);
        return '';  // 返回空字符串，避免继续执行
    }

    let interpretation = data.interpretation;
    if (!interpretation.includes('<br>')) {
        interpretation = interpretation.replace(/([，。！？、])/g, '\$1<br>');
    }

    const html = template
        .replace(/{{word}}/g, data.word)
        .replace('{{spell}}', data.spell)
        .replace('{{english}}', data.english)
        .replace('{{japanese}}', data.japanese)
        .replace('{{interpretation}}', interpretation)
        .replace('{{summary}}', data.summary);

    return html;
}


// 使用 Puppeteer 生成图片并返回 Base64 编码
async function generateImage(html) {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({
        width: 450, // 页面宽度
        height: 800, // 页面高度
        deviceScaleFactor: 2, // 设置设备像素比为 2，以提高清晰度
    });

    // 设置页面内容为生成的 HTML
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // 选择带有指定 class 的元素
    const element = await page.$(`.card`);

    if (!element) {
        console.error(`元素 .card 未找到`);
        await browser.close();
        return null;
    }

    // 对指定元素截图并生成 Base64 编码
    const imageBuffer = await element.screenshot({ encoding: 'base64',omitBackground: true });

    await browser.close();
    return imageBuffer;
}


// 启动服务器
app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
