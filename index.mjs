import { load } from "cheerio";
import fs from "fs";
import { http } from "./http.mjs";
import { sync } from "./lark.mjs";

const configFile = '.config';
let cursor = 1;
let total = Infinity;
let latestID = 0;
const links = [];

if (fs.existsSync(configFile)) {
  latestID = fs.readFileSync(configFile, "utf-8");
}

const fetchList = async (cursor) => {
  const response = await http.get(
    "https://auctions.yahoo.co.jp/closedsearch/closedsearch",
    {
      params: {
        p: "洋蘭 C. -sib -phal",
        auccat: "2084048019",
        va: "洋蘭 C.",
        ve: "sib phal",
        aucminprice: 5000,
        thumb: 1,
        b: cursor,
        n: 100,
      },
    }
  );

  return load(response.data);
};

while (cursor < total) {
  const $ = await fetchList(cursor);

  if (total === Infinity) {
    total = Number(
      $(".SearchMode__title")
        .text()
        .match(/\s([0-9,]+)件/)[1]
        .replace(",", "")
    );
  }

  $(".Product").each(function () {
    const link = $(this).find(".Product__titleLink").attr("href");
    const ID = link.slice(link.lastIndexOf('/') + 1);
    if (ID !== latestID) {
      links.push(link);
    } else {
      cursor = Infinity;
      return false;
    }
  });

  cursor += 100;
}

const totalLinks = links.length;
let currentLink = 0;

console.log(`共${totalLinks}条记录，处理中...`);

while(links.length > 0) {
  const link = links.pop();

  currentLink += 1;

  console.log(
    `正在处理第${currentLink}条记录，地址是${link}，进度为${(currentLink * 100/totalLinks).toFixed()}%;`
  );

  const response = await http.get(link);
  const $ = load(response.data);

  const section = $(".Section__tableData");
  const id = section.eq(12).text().trim();

  const title = $(".ProductTitle__text").eq(0).text().trim();
  const nameMatch = title.match(/C\.?[0-9a-z-.()/''‘’ ]+/i);
  const speciesMatch = title.match(/C\.?\s?[a-z]+/i);
  const individualMatch = title.match(/['`‘’´]([a-z. ]+)['’｀]?/i);
  const timesMatch = $(".Count__detail").eq(0).text().match(/(\d+)/);

  const images = new Set();
  $(".ProductImage__images img").each(function () {
    images.add($(this).attr("src"));
  });

  const record = {
    id,
    link,
    title,
    name: nameMatch ? nameMatch[0].trim() : "",
    species: speciesMatch ? speciesMatch[0].trim() : "",
    individual: /\s?[xX]\s+/.test(title)
      ? ""
      : individualMatch
      ? individualMatch[1].trim()
      : "",
    description: $(".ProductExplanation__commentBody")
      .text()
      .trim()
      .replace(/^\n/, "")
      .replace(/\n$/, ""),
    startPrice: Number(
      section.eq(9).text().replace(/円.*/, "").replace(",", "").trim()
    ),
    endPrice: Number(
      $(".Price__value").eq(0).text().replace(/円.*/, "").replace(",", "").trim()
    ),
    times: Number(timesMatch ? timesMatch[1] : 1),
    images: Array.from(images),
    startTime: new Date(
      section
        .eq(10)
        .text()
        .trim()
        .replace(/（.+）/g, " ")
    ).getTime(),
    endTime: new Date(
      section
        .eq(11)
        .text()
        .trim()
        .replace(/（.+）/g, " ")
    ).getTime(),
    seller: $(".Seller__name a").text().trim(),
  };

  await sync(record);

  fs.writeFileSync(configFile, String(id));
}

console.log();
console.log(`记录同步完毕.`);
console.log();

process.exit(0);
