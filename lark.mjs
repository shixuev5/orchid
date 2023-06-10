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
      },
      lark.withUserAccessToken(process.env.appAccessToken)
    );
    attachment.push(result)
    await sleep(1);
  }
  
  return client.bitable.appTableRecord.create(
    {
      data: {
        fields: {
          '编号': record.id,
          '品种名': record.species,
          '个体名': record.individual,
          '全名': record.name,
          '标题': record.title,
          '描述': record.description,
          '附件': attachment,
          '拍卖链接': { link: record.link },
          '竞拍次数': record.times,
          '拍卖开始时间': record.startTime,
          '拍卖结束时间': record.endTime,
          '拍卖开始价格': record.startPrice,
          '拍卖结束价格': record.endPrice,
          '拍卖人': record.seller,
        },
      },
      path: { app_token: process.env.appToken, table_id: process.env.tableId },
    },
    lark.withUserAccessToken(process.env.appAccessToken)
  );
}