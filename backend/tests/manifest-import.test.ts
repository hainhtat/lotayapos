import { extractPhonesFromText, parseDeliveryManifestItems, parseDeliveryManifestText } from "../src/utils/manifest-text-parser.js";
import { itemsHaveReadableText } from "../src/utils/pdf-text.js";

describe("OS delivery manifest parsing", () => {
  test("parses representative rows across two pages and preserves Myanmar Unicode", () => {
    const pages = [
      `Delivery Manifest\nNo.  Customer              Address                              Phone          Amount\n1    Ma Su                 12 Insein Road, Kamayut              09 777 111222  100,000\n2    ကိုအောင်                အမှတ် ၅၊ စမ်းချောင်းမြို့နယ်                               25,000`,
      `Delivery Manifest\nNo.  Customer              Address                              Phone          Amount\n3    Daw Mya                8 Baho Road, Sanchaung               09-444555666   200,000`,
    ];
    expect(parseDeliveryManifestText(pages)).toEqual([
      { reference: "1", customerName: "Ma Su", address: "12 Insein Road, Kamayut", phone: "09 777 111222", codAmount: 100000, sourcePage: 1 },
      { reference: "2", customerName: "ကိုအောင်", address: "အမှတ် ၅၊ စမ်းချောင်းမြို့နယ်", codAmount: 25000, sourcePage: 1 },
      { reference: "3", customerName: "Daw Mya", address: "8 Baho Road, Sanchaung", phone: "09-444555666", codAmount: 200000, sourcePage: 2 },
    ]);
  });

  test("caps recognized rows", () => {
    const rows = Array.from({ length: 520 }, (_, index) => `${index + 1}    Customer ${index}          Address ${index}                    1,000`).join("\n");
    expect(parseDeliveryManifestText([rows])).toHaveLength(500);
  });

  test("pulls Myanmar and glued phones out of address text", () => {
    expect(extractPhonesFromText("12 Insein Road ၀၉၇၇၇၁၁၁၂၂၂").phones).toEqual(["09777111222"]);
    expect(extractPhonesFromText("Kamayut 0942446456609943106528").phones).toEqual(["09424464566", "09943106528"]);
    expect(extractPhonesFromText("Kamayut 0942446456609943106528").rest).toBe("Kamayut");
  });

  test("keeps township names in the address and does not invent a township match", () => {
    const rows = parseDeliveryManifestText([
      "1    Ma Su                 12 Insein Road, Kamayut 09 777 111222              100,000",
    ]);
    expect(rows).toEqual([
      {
        reference: "1",
        customerName: "Ma Su",
        address: "12 Insein Road, Kamayut",
        phone: "09777111222",
        codAmount: 100000,
        sourcePage: 1,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("townshipId");
  });

  test("treats digit-only PDF text as unreadable so scanned pages require OCR", () => {
    expect(itemsHaveReadableText([{ str: "12 34,000 —", x: 0, y: 0, page: 1 }])).toBe(false);
    expect(itemsHaveReadableText([{ str: "Kamayut", x: 0, y: 0, page: 1 }])).toBe(true);
    expect(itemsHaveReadableText([{ str: "ကမာရွတ်", x: 0, y: 0, page: 1 }])).toBe(true);
  });

  test("parses shop-manifest columns with order No. and phones left in the address", () => {
    const rows = parseDeliveryManifestItems([
      { str: "8", x: 65, y: 700, page: 1 },
      { str: "Ma Su", x: 110, y: 712, page: 1 },
      { str: "12 Insein Road, Kamayut", x: 230, y: 700, page: 1 },
      { str: "09 777 111222", x: 230, y: 686, page: 1 },
      { str: "—", x: 411, y: 700, page: 1 },
      { str: "100,000 MMK", x: 492, y: 700, page: 1 },
      { str: "12", x: 65, y: 640, page: 1 },
      { str: "Shin Lay", x: 110, y: 640, page: 1 },
      { str: "Bahan 09424464566", x: 230, y: 640, page: 1 },
      { str: "25,000 MMK", x: 492, y: 640, page: 1 },
      { str: "ေအးဘုရားလမ်း၊ဗဟန်း", x: 230, y: 780, page: 2 },
      { str: "13", x: 65, y: 700, page: 2 },
      { str: "Daw Mya", x: 110, y: 700, page: 2 },
      { str: "8 Baho Road", x: 230, y: 700, page: 2 },
      { str: "200,000 MMK", x: 492, y: 700, page: 2 },
    ]);
    expect(rows).toEqual([
      {
        reference: "8",
        customerName: "Ma Su",
        address: "12 Insein Road, Kamayut",
        phone: "09777111222",
        codAmount: 100000,
        sourcePage: 1,
      },
      {
        reference: "12",
        customerName: "Shin Lay",
        address: "Bahan ေအးဘုရားလမ်း၊ဗဟန်း",
        phone: "09424464566",
        codAmount: 25000,
        sourcePage: 1,
      },
      {
        reference: "13",
        customerName: "Daw Mya",
        address: "8 Baho Road",
        codAmount: 200000,
        sourcePage: 2,
      },
    ]);
  });

  test("parses scaled and shifted shop-manifest coordinates with Ks and bare COD amounts", () => {
    const rows = parseDeliveryManifestItems([
      { str: "21", x: 330, y: 1400, page: 1 },
      { str: "Ko Min", x: 420, y: 1424, page: 1 },
      { str: "North Dagon", x: 660, y: 1400, page: 1 },
      { str: "09 777 111222", x: 660, y: 1372, page: 1 },
      { str: "75,000 Ks", x: 1184, y: 1400, page: 1 },
      { str: "22", x: 330, y: 1280, page: 1 },
      { str: "Daw Nu", x: 420, y: 1280, page: 1 },
      { str: "Hlaing", x: 660, y: 1280, page: 1 },
      { str: "30,000", x: 1184, y: 1280, page: 1 },
    ]);

    expect(rows).toEqual([
      { reference: "21", customerName: "Ko Min", address: "North Dagon", phone: "09777111222", codAmount: 75000, sourcePage: 1 },
      { reference: "22", customerName: "Daw Nu", address: "Hlaing", codAmount: 30000, sourcePage: 1 },
    ]);
  });

  test("merges text fallback rows when geometry recognizes only part of a page", () => {
    const rows = parseDeliveryManifestItems([
      { str: "1", x: 65, y: 700, page: 1 },
      { str: "Ma Su", x: 110, y: 700, page: 1 },
      { str: "Kamayut", x: 230, y: 700, page: 1 },
      { str: "10,000 MMK", x: 492, y: 700, page: 1 },
      { str: "2    Ko Aung              Bahan Road                    20,000", x: 65, y: 640, page: 1 },
    ]);

    expect(rows.map((row) => row.reference)).toEqual(["1", "2"]);
  });

  test("keeps a one-row manifest block whose details sit well below its order anchor", () => {
    expect(parseDeliveryManifestItems([
      { str: "31", x: 65, y: 700, page: 1 },
      { str: "Ko Tun", x: 110, y: 688, page: 1 },
      { str: "Thingangyun", x: 230, y: 660, page: 1 },
      { str: "45,000 MMK", x: 492, y: 660, page: 1 },
    ])).toEqual([
      { reference: "31", customerName: "Ko Tun", address: "Thingangyun", codAmount: 45000, sourcePage: 1 },
    ]);
  });

  test("infers narrow customer and wide address columns without shifting cells", () => {
    const rows = parseDeliveryManifestItems([
      { str: "No.", x: 59, y: 691, page: 1 },
      { str: "Customer", x: 88, y: 691, page: 1 },
      { str: "Address", x: 256, y: 691, page: 1 },
      { str: "Phone", x: 429, y: 691, page: 1 },
      { str: "Amount", x: 499, y: 691, page: 1 },
      { str: "145", x: 59, y: 362, page: 1 },
      { str: "Thar Thar", x: 88, y: 362, page: 1 },
      { str: "-vb", x: 124, y: 362, page: 1 },
      { str: "466 Thamardi Road", x: 256, y: 376, page: 1 },
      { str: "North Dagon", x: 316, y: 348, page: 1 },
      { str: "09431844874", x: 256, y: 348, page: 1 },
      { str: "—", x: 453, y: 362, page: 1 },
      { str: "44,400 MMK", x: 475, y: 362, page: 1 },
      { str: "146", x: 59, y: 304, page: 1 },
      { str: "Kay Thi Htun", x: 88, y: 304, page: 1 },
      { str: "UMFCCI Tower", x: 256, y: 304, page: 1 },
      { str: "09-421000209", x: 286, y: 290, page: 1 },
      { str: "—", x: 453, y: 304, page: 1 },
      { str: "38,250 MMK", x: 476, y: 304, page: 1 },
      { str: "18/08/2026, 15", x: 490, y: 250, page: 1 },
      { str: "08", x: 545, y: 250, page: 1 },
      { str: "Page 1 of 1", x: 514, y: 242, page: 1 },
    ]);

    expect(rows).toEqual([
      { reference: "145", customerName: "Thar Thar -vb", address: "466 Thamardi Road North Dagon", phone: "09431844874", codAmount: 44400, sourcePage: 1 },
      { reference: "146", customerName: "Kay Thi Htun", address: "UMFCCI Tower", phone: "09421000209", codAmount: 38250, sourcePage: 1 },
    ]);
  });
});
