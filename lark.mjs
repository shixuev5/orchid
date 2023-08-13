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

export async function sync(record) {
  const attachment = []

  for (const imgSrc of record.images) {
    const { size, file } = await getImageStream(imgSrc);
    const result = await client.drive.media.uploadAll(
      {
        data: {
          file_name: imgSrc.match(/\/([^/]+)$/)[1],
          parent_type: "bitable_image",
          parent_node: process.env.appToken,
          size,
          file,
        },
      }
    );
    attachment.push(result)
    await sleep(1);
  }
  
  return client.bitable.appTableRecord.create(
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
  );
}
