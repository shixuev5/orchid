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
  latestID = fs.readFileSync(configFile, "utf-8").trim();
  console.log('读取到上一次同步 ID 为: ' + latestID)
} else {
  console.log('不存在配置文件')
}

const fetchList = async (cursor) => {
  const response = await http.get(
    "https://auctions.yahoo.co.jp/closedsearch/closedsearch",
    {
      params: {
        p: "洋蘭 (C. Cattleya カトレア) -sib -phal -rlc",
        auccat: "2084207337",
        va: "洋蘭",
        ve: "sib phal rlc",
        vo: "C. Cattleya カトレア",
        aucminprice: 5000,
        thumb: 1,
        b: cursor,
        n: 100,
      },
    }
  );

  return load(response.data);
};

// 返回 C. xxx
function normalizeGenera(str) {
  return str.replace(/^([CcPpLl])\.?\s*(.+)$/, (_, $1, $2) => `${$1.toUpperCase()}. ${$2}`);
}

// 判断属名
function judgeGenera(str) {
  let genera = ''
  if (str.startsWith('C')) {
    genera = 'Cattleya'
  } else if (str.startsWith('L')) {
    genera = 'Laelia'
  } else if (str.startsWith('P')) {
    genera = 'Phalaenopsis'
  }
  return genera;
}

while (cursor < total) {
  const $ = await fetchList(cursor);

  if (total === Infinity) {
    total = Number(
      $(".SearchMode__title")
        .text()
        .match(/\s([0-9,]+)件/)[1]
        .replace(",", "")
    );
    console.log('获取到数据总条数为：' + total);
  }

  $(".Product").each(function () {
    const link = $(this).find(".Product__titleLink").attr("href");
    const ID = link.slice(link.lastIndexOf('/') + 1);
    if (ID !== latestID) {
      console.log('发现新的未处理记录，记录 ID 为：' + ID);
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

  const pageData = JSON.parse($("meta[name=next-head-count]").prev().text().replace('var pageData = ', '').replace(/;$/, '')).items;
  const id = pageData.productID;

  const title = $('#itemTitle h1').text().replace(/Cattleya\.?/i, 'C.').trim();
  const description = $("#description").text().trim().replace(/^\n/, "").replace(/\n$/, "");
  // 学名
  const nameMatch = title.match(/C\.?[0-9a-z&#-.()/×'`´‘’“”｀\s]+/i) ?? description.match(/C\.?[0-9a-z&#-.()/×'`´‘’“”｀\s]+/i);
  const name = normalizeGenera(nameMatch ? nameMatch[0].trim() : "");
  // 种
  const speciesMatch = name.match(/C\.?\s?[a-z]+/i);
  const species = normalizeGenera(speciesMatch ? speciesMatch[0].trim() : "");
  // 品种
  const individualMatch = name.match(/['`´‘’“”｀]([0-9a-z&#.\s]+)['`´‘’“”｀]?/i);
  const individual = /\s?[×xX]\s+/.test(name) ? "-" : individualMatch ? individualMatch[1].trim() : "-"

  const images = new Set();
  $(".slick-track img").each(function () {
    images.add($(this).attr("src"));
  });

  // 出售者
  const seller = $('#__NEXT_DATA__').text().match(/"displayName":"([^"]+)"/)?.[1] ?? ""

  const record = {
    id,
    genera: judgeGenera(species),
    species,
    individual,
    name,
    description,
    link,
    startPrice: Number($('#__NEXT_DATA__').text().match(/"initPrice":(\d+)/)?.[1] ?? 0),
    endPrice: Number(pageData.price),
    times: Number(pageData.bids),
    images: Array.from(images).slice(0, 6),
    endTime: new Date(pageData.endtime).getTime(),
    seller
  };
    
  const res = await sync(record);
  if (res.code !== 0) {
    console.log(res);
    process.exit(1);
  }

  fs.writeFileSync(configFile, String(id));
}

console.log();
console.log(`记录同步完毕.`);
console.log();

process.exit(0);
