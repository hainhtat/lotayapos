import { ApiError } from "../utils/api-error.js";

export function calculateRiderSettlementAmounts(input: { cod:number; fees:number; commission:number; cash:number; kbzPay:number; wavePay:number; salaryDeduction?:number }) {
  const salaryDeduction=input.salaryDeduction??0;
  if(!Number.isInteger(salaryDeduction)||salaryDeduction<0)throw new ApiError(400,"INVALID_SALARY_DEDUCTION","Salary deduction must be a non-negative integer");
  const expectedAmount=input.cod+input.fees-input.commission-salaryDeduction;
  const actualAmount=input.cash+input.kbzPay+input.wavePay;
  return {expectedAmount,actualAmount,variance:actualAmount-expectedAmount,salaryDeduction};
}

export function buildRiderSettlementReceivableLines(actualAmount:number,salaryDeduction:number){
  if(!Number.isInteger(actualAmount)||actualAmount<0||!Number.isInteger(salaryDeduction)||salaryDeduction<0)throw new ApiError(400,"INVALID_SETTLEMENT_AMOUNT","Settlement and salary amounts must be non-negative integers");
  return salaryDeduction>0?[{account:"RIDER_RECEIVABLE",debit:0,credit:actualAmount+salaryDeduction},{account:"RIDER_RECEIVABLE",debit:salaryDeduction,credit:0}]:[{account:"RIDER_RECEIVABLE",debit:0,credit:actualAmount}];
}

export function calculateDailySalaryDeduction(monthlySalary:number|null|undefined,businessDate:Date,payModel:string|null|undefined){
  if(payModel!=="SALARY"&&payModel!=="SALARY_PLUS_PERCENTAGE")return 0;
  if(!Number.isInteger(monthlySalary)||!monthlySalary||monthlySalary<=0)return 0;
  const daysInMonth=new Date(Date.UTC(businessDate.getUTCFullYear(),businessDate.getUTCMonth()+1,0)).getUTCDate();
  return Math.floor(monthlySalary/daysInMonth);
}

export type SettlementParcel={codAmount:number;deliveryFee:number;commissionAmount:number;linkGroup?:{id:string;totalDeliveryFee:number;parcelStatuses:string[]}|null};

export function calculateRecognitionTotals(recognitions:Array<{codAmount:number;deliveryFee:number;commissionAmount:number}>){
  return recognitions.reduce((sum,recognition)=>({cod:sum.cod+recognition.codAmount,fees:sum.fees+recognition.deliveryFee,commission:sum.commission+recognition.commissionAmount}),{cod:0,fees:0,commission:0});
}

export function calculateRiderSettlementTotals(parcels:SettlementParcel[],commissionRateBps:number){
  const countedGroups=new Set<string>();
  return parcels.reduce((totals,parcel)=>{totals.cod+=parcel.codAmount;if(parcel.linkGroup){if(!parcel.linkGroup.parcelStatuses.every(status=>status==="DELIVERED"))return totals;if(!countedGroups.has(parcel.linkGroup.id)){countedGroups.add(parcel.linkGroup.id);totals.fees+=parcel.linkGroup.totalDeliveryFee;totals.commission+=Math.round(parcel.linkGroup.totalDeliveryFee*commissionRateBps/10000)}return totals}totals.fees+=parcel.deliveryFee;totals.commission+=parcel.commissionAmount;return totals},{cod:0,fees:0,commission:0});
}
