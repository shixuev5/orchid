import * as lark from "@larksuiteoapi/node-sdk";
import { http } from "./http.mjs";

const client = new lark.Client({
  appId: process.env.appId,
  appSecret: process.env.appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

async function getImageStream(imgSrc) {
  const response = await http.get(imgSrc, { responseType: "stream" });
  return { size: response.headers.getContentLength(), file: response.data };
}

const sleep = (time = 1) => new Promise((resolve) => setTimeout(() => resolve(), time * 1000));

function getStatus(error) {
  return error?.response?.status ?? error?.status ?? error?.code;
}

function isRetryable(error) {
  const status = getStatus(error);
  return status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
}

async function withRetry(task, { retries = 5, label = "request" } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt > retries) {
        throw error;
      }

      const wait = Math.min(30, 2 ** (attempt - 1));
      console.warn(`${label} failed with ${getStatus(error)}, retrying in ${wait}s (${attempt}/${retries})`);
      await sleep(wait);
    }
  }

  throw lastError;
}

export async function sync(record) {
  const attachment = []

  for (const imgSrc of record.images) {
    const { size, file } = await getImageStream(imgSrc);
    const result = await withRetry(() => client.drive.media.uploadAll(
      {
        data: {
          file_name: imgSrc.match(/\/([^/]+)$/)[1],
          parent_type: "bitable_image",
          parent_node: process.env.appToken,
          size,
          file,
        },
      }
    ), { label: `upload image for ${record.id}` });
    attachment.push(result)
    await sleep(1);
  }
  
  return withRetry(() => client.bitable.appTableRecord.create(
    {
      data: {
        fields: {
          '编号': record.id,
          '属': record.genera,
          '种': record.species,
          '品种': record.individual,
          '学名': record.name,
          '描述': record.description,
          '附件': attachment,
          '竞拍次数': record.times,
          '起拍价': record.startPrice,
          '结拍价': record.endPrice,
          '出售者': record.seller,
          '购买者': '-',
          '出售时间': record.endTime,
          '链接': { link: record.link },
        },
      },
      path: { app_token: process.env.appToken, table_id: process.env.tableId },
    }
  ), { label: `create record ${record.id}` });
}
