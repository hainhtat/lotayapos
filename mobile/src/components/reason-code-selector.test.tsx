import {fireEvent,render} from "@testing-library/react-native";
import {ReasonCodeSelector} from "./reason-code-selector";
import {i18n} from "@/i18n";
import type {ReasonCode} from "@/lib/api";

const reason:ReasonCode={id:"reason-1",code:"NO_ANSWER",labelEn:"Customer did not answer",labelMy:"ဖောက်သည် ဖုန်းမကိုင်ပါ",outcome:"FAILED",noteRequired:true,active:true};
describe("outcome reason selection",()=>{
  afterEach(()=>{i18n.locale="en"});
  it("selects the canonical reason and reveals its required note",async()=>{
    const onSelect=jest.fn();const props={reasons:[reason],selected:null,note:"",loading:false,error:false,dark:false,onSelect,onNoteChange:jest.fn(),onRetry:jest.fn()};
    const screen=await render(<ReasonCodeSelector {...props}/>);await fireEvent.press(screen.getByLabelText("Customer did not answer"));expect(onSelect).toHaveBeenCalledWith(reason);
    await screen.rerender(<ReasonCodeSelector {...props} selected={reason}/>);expect(screen.getByLabelText("Customer did not answer").props.accessibilityState.selected).toBe(true);expect(screen.getByLabelText("Additional note")).toBeTruthy();
  });
  it("uses the Myanmar label",async()=>{i18n.locale="my";const screen=await render(<ReasonCodeSelector reasons={[reason]} selected={null} note="" loading={false} error={false} dark={false} onSelect={jest.fn()} onNoteChange={jest.fn()} onRetry={jest.fn()}/>);expect(screen.getByLabelText("ဖောက်သည် ဖုန်းမကိုင်ပါ")).toBeTruthy()});
});
