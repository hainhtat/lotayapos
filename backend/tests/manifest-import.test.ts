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
});
