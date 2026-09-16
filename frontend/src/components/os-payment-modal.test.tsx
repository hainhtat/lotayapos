import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import "@/i18n";
import {OsPaymentModal} from "./os-payment-modal";

describe("OS payment modal",()=>{
 it("shows the selected batch, actionable blocker and server error inside the dialog",()=>{
  const submit=vi.fn();
  render(<OsPaymentModal correct={false} shop="Shop" rows={[{batchId:"b",label:"September batch",outstanding:100}]} form={{date:"2026-09-16",cash:"80",kbzPay:"0",wavePay:"0",note:"",reference:""}} change={vi.fn()} reason="" changeReason={vi.fn()} credit={20} outstanding={100} pending={false} locked={false} error="Cashbook is closed" blockers={["paymentNoteRequired"]} submit={submit} close={vi.fn()}/>);
  expect(screen.getByRole("dialog")).toContainElement(screen.getByRole("alert"));
  expect(screen.getByText("Enter a note with at least 3 characters.")).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Save"})).toBeDisabled();
  fireEvent.submit(screen.getByRole("dialog"));
  expect(submit).not.toHaveBeenCalled();
 });
});
