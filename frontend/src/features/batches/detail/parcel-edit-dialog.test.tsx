import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import "@/i18n";
import { ParcelEditDialog, type ParcelEditFields } from "./parcel-edit-dialog";

const initial: ParcelEditFields = { orderId: "1", customerName: "Customer", address: "Street", customerPhone: "", codAmount: "10000", deliveryFee: "1000", townshipId: "town-1", zoneId: "zone-1" };

it("updates the configured fee when township changes and submits the edited parcel", () => {
  const onSave = vi.fn();
  function Fixture() {
    const [fields, setFields] = useState(initial);
    return <ParcelEditDialog
      parcel={{ id: "parcel-1", trackingNumber: "LTY-1", customerName: "Customer", address: "Street", status: "CREATED", codAmount: 10000 }}
      fields={fields} setFields={setFields}
      townships={[{ id: "town-1", nameEn: "Old", deliveryFee: 1000 }, { id: "town-2", nameEn: "New", deliveryFee: 2500 }]}
      zones={[]} pending={false} onSave={onSave} onClose={vi.fn()} onHistory={vi.fn()}
    />;
  }
  render(<Fixture />);
  fireEvent.change(screen.getByRole("combobox", { name: "Township" }), { target: { value: "town-2" } });
  expect(screen.getByRole("spinbutton", { name: "Delivery fee" })).toHaveValue(2500);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledOnce();
});
