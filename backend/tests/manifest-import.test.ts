import { parseDeliveryManifestText } from "../src/utils/manifest-text-parser.js";

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
});
