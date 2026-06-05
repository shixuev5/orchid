import { load } from "cheerio";
import fs from "fs";
import { http } from "./http.mjs";
import { sync } from "./lark.mjs";

const configFile = '.config';
const PAGE_SIZE = 100;
let cursor = 1;
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

function getNextData($) {
  const data = $('#__NEXT_DATA__').text();
  if (!data) {
    throw new Error('页面缺少 __NEXT_DATA__，无法解析 Yahoo 新页面数据。');
  }

  return JSON.parse(data);
}

function getProductLinks($) {
  const data = getNextData($);
  const items = data.props?.pageProps?.initialState?.search?.items?.listing?.items;

  if (!Array.isArray(items)) {
    throw new Error('页面 __NEXT_DATA__ 中缺少 search.items.listing.items，无法解析列表数据。');
  }

  return items
    .map((item) => item.auctionId)
    .filter(Boolean)
    .map((id) => `https://auctions.yahoo.co.jp/jp/auction/${id}`);
}

function getProductID(link) {
  const url = new URL(link);
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function getDetailItem($) {
  const data = getNextData($);
  const item = data.props?.pageProps?.initialState?.item?.detail?.item;

  if (!item?.auctionId) {
    throw new Error('页面 __NEXT_DATA__ 中缺少 item.detail.item，无法解析详情数据。');
  }

  return item;
}

function getDescription(item) {
  if (item.descriptionHtml) {
    return load(item.descriptionHtml).text().trim();
  }

  if (Array.isArray(item.description)) {
    return item.description.join('\n').trim();
  }

  return String(item.description ?? '').trim();
}

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

const seenProductIDs = new Set();
let reachedLatestID = false;

while (true) {
  const $ = await fetchList(cursor);
  const pageLinks = [];

  for (const link of getProductLinks($)) {
    const ID = getProductID(link);
    if (!ID || seenProductIDs.has(ID)) {
      continue;
    }

    seenProductIDs.add(ID);
    if (ID !== latestID) {
      console.log('发现新的未处理记录，记录 ID 为：' + ID);
      pageLinks.push(link);
    } else {
      console.log('已找到上一次同步记录，停止读取列表。');
      reachedLatestID = true;
      break;
    }
  }

  links.push(...pageLinks);

  if (reachedLatestID) {
    break;
  }

  if (pageLinks.length === 0) {
    console.log(`第 ${cursor} 条开始的列表页没有发现新的商品链接，停止读取列表。`);
    break;
  }

  cursor += PAGE_SIZE;
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

  const item = getDetailItem($);
  const id = item.auctionId;

  const title = item.title.replace(/Cattleya\.?/i, 'C.').trim();
  const description = getDescription(item);
  // 学名
  const nameMatch = title.match(/C\.?[0-9a-z&#-.()/×'`´‘’“”｀\s]+/i) ?? description.match(/C\.?[0-9a-z&#-.()/×'`´‘’“”｀\s]+/i);
  const name = normalizeGenera(nameMatch ? nameMatch[0].trim() : "");
  // 种
  const speciesMatch = name.match(/C\.?\s?[a-z]+/i);
  const species = normalizeGenera(speciesMatch ? speciesMatch[0].trim() : "");
  // 品种
  const individualMatch = name.match(/['`´‘’“”｀]([0-9a-z&#.\s]+)['`´‘’“”｀]?/i);
  const individual = /\s?[×xX]\s+/.test(name) ? "-" : individualMatch ? individualMatch[1].trim() : "-"

  const images = new Set(item.img?.map((image) => image.image).filter(Boolean) ?? []);

  // 出售者
  const seller = item.seller?.displayName ?? ""

  const record = {
    id,
    genera: judgeGenera(species),
    species,
    individual,
    name,
    description,
    link,
    startPrice: Number(item.initPrice ?? 0),
    endPrice: Number(item.price ?? 0),
    times: Number(item.bids ?? 0),
    images: Array.from(images).slice(0, 6),
    endTime: new Date(item.endTime).getTime(),
    seller
  };
    
  let res;
  try {
    res = await sync(record);
  } catch (error) {
    console.error(`Sync failed for ${id} (${link})`);
    console.error(error?.response?.data ?? error?.response?.status ?? error?.message ?? error);
    process.exit(1);
  }

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
