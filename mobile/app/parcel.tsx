import {useState} from "react";
import {Alert,Linking,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import * as Clipboard from "expo-clipboard";
import {router,useLocalSearchParams} from "expo-router";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api,getAssignedParcel,getReasonCodes,type ReasonCode} from "@/lib/api";
import {i18n} from "@/i18n";
import {useTheme} from "@/providers/theme";
import {buildOutcomePayload,reasonErrorKey} from "@/lib/outcomes";
import type {Outcome} from "@/lib/outcomes";
import {ReasonCodeSelector} from "@/components/reason-code-selector";
import {SelectMenu} from "@/components/select-menu";
import {callCustomer,sanitizedCustomerPhone} from "@/lib/phone";
import {isUndeliveredParcel} from "@/lib/route-parcels";

export default function Parcel(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {theme}=useTheme();
  const queryClient=useQueryClient();
  const parcelQuery=useQuery({queryKey:["assigned-parcel",id],queryFn:()=>getAssignedParcel(id),enabled:Boolean(id)});
  const dark=theme==="dark";
  const [choice,setChoice]=useState<Outcome>("DELIVERED");
  const [reason,setReason]=useState<ReasonCode|null>(null);
  const [note,setNote]=useState("");
  const [actualCod,setActualCod]=useState("");
  const [collectionWallet,setCollectionWallet]=useState<"CASH"|"KBZ_PAY"|"WAVE_PAY"|"">("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [started,setStarted]=useState(false);
  const currentStatus=started?"OUT_FOR_DELIVERY":parcelQuery.data?.status;
  const originalCod=parcelQuery.data?.codAmount??0;
  const reasonsQuery=useQuery({queryKey:["reason-codes",choice],queryFn:()=>getReasonCodes(choice as ReasonCode["outcome"]),enabled:choice!=="DELIVERED"});

  const save=async()=>{
    const result=buildOutcomePayload({outcome:choice,reason:reason?.code??"",note,noteRequired:reason?.noteRequired,actualCod,originalCod,collectionWallet});
    if(result.error){setError(i18n.t(result.error==="reason"?(reasonErrorKey(choice)??"requestError"):result.error));return}
    setSaving(true);setError("");
    try{await api(`/parcels/${id}/status`,{method:"POST",body:JSON.stringify(result.payload)});await queryClient.invalidateQueries({queryKey:["assigned-parcels"]});router.back()}
    catch(e){setError(e instanceof Error?e.message:i18n.t("requestError"))}
    finally{setSaving(false)}
  };
  const confirmSave=()=>Alert.alert(i18n.t("confirmTitle"),i18n.t("confirmOutcome",{outcome:i18n.t(choice.toLowerCase())}),[{text:i18n.t("cancel"),style:"cancel"},{text:i18n.t("confirm"),onPress:()=>void save()}]);
  const call=async()=>{
    const phone=parcelQuery.data?.customerPhone;
    const result=await callCustomer(phone,Linking);
    if(result==="opened")return;
    const digits=sanitizedCustomerPhone(phone);
    Alert.alert(
      i18n.t("callUnavailableTitle"),
      i18n.t(result==="missing"?"phoneMissing":"callUnavailable"),
      [
        {text:i18n.t("cancel"),style:"cancel"},
        ...(digits?[{text:i18n.t("copyPhone"),onPress:()=>void Clipboard.setStringAsync(digits)}]:[]),
      ],
    );
  };

  if(parcelQuery.isLoading)return <SafeAreaView style={[s.safe,dark&&s.dark]}><View style={s.content}><Text style={s.muted}>{i18n.t("loading")}</Text></View></SafeAreaView>;
  if(parcelQuery.isError)return <SafeAreaView style={[s.safe,dark&&s.dark]}><View style={s.content}><Text accessibilityRole="alert" style={s.error}>{i18n.t("requestError")}</Text><Pressable accessibilityRole="button" onPress={()=>void parcelQuery.refetch()} style={s.button}><Text style={s.buttonText}>{i18n.t("retry")}</Text></Pressable></View></SafeAreaView>;
  if(!parcelQuery.data)return <SafeAreaView style={[s.safe,dark&&s.dark]}><View style={s.content}><Text accessibilityRole="alert" style={s.error}>{i18n.t("empty")}</Text><Pressable accessibilityRole="button" onPress={()=>router.back()} style={s.button}><Text style={s.buttonText}>{i18n.t("back")}</Text></Pressable></View></SafeAreaView>;
  const parcel=parcelQuery.data;
  return <SafeAreaView style={[s.safe,dark&&s.dark]}><ScrollView contentContainerStyle={s.content}>
    <Pressable accessibilityRole="button" accessibilityLabel={i18n.t("back")} onPress={()=>router.back()}><Text style={s.back}>‹ {i18n.t("back")}</Text></Pressable>
    <Text style={s.kicker}>{i18n.t("deliveryUpdate")}</Text><Text style={[s.title,dark&&s.white]}>{parcel.trackingNumber}</Text><Text style={s.muted}>{parcel.customerName} · {parcel.customerPhone??"—"}</Text><Pressable accessibilityRole="button" accessibilityLabel={i18n.t("callCustomer",{name:parcel.customerName})} onPress={()=>void call()} style={s.call}><Text style={s.callText}>☎ {i18n.t("call")}</Text></Pressable><Text style={s.muted}>{parcel.address}</Text><Text style={s.muted}>{i18n.t("parcelMoneyLine",{cod:parcel.codAmount.toLocaleString(),fee:parcel.deliveryFee.toLocaleString()})}</Text>
    {parcel.linkedParcelGroupId&&<View style={s.group}><Text style={s.groupTitle}>{i18n.t("linkedParcels")}</Text><Text style={s.groupText}>{i18n.t("linkedParcelCount",{count:parcel.linkedParcelCount??2})}</Text></View>}
    {!isUndeliveredParcel(parcel)&&<Text style={s.muted}>{i18n.t("currentStatus")}: {i18n.t(({DELIVERED:"delivered",PARTIAL:"partial",FAILED:"failed",REJECTED:"rejected",PENDING_RETURN:"pending",RETURNED:"pending",CANCELLED:"rejected"} as Record<string,string>)[parcel.status]??"pending")}</Text>}
    {isUndeliveredParcel(parcel)&&<>
    <Text style={s.muted}>{i18n.t("outcomeHelp")}</Text>
    {currentStatus==="ASSIGNED"&&<Pressable disabled={saving} onPress={async()=>{setSaving(true);setError("");try{await api(`/parcels/${id}/status`,{method:"POST",body:JSON.stringify({status:"OUT_FOR_DELIVERY"})});setStarted(true);await queryClient.invalidateQueries({queryKey:["assigned-parcels"]})}catch(e){setError(e instanceof Error?e.message:i18n.t("requestError"))}finally{setSaving(false)}}} style={s.button}><Text style={s.buttonText}>{i18n.t("deliveryUpdate")}</Text></Pressable>}
    {currentStatus==="OUT_FOR_DELIVERY"&&<>
    <SelectMenu
      label={i18n.t("status")}
      value={choice}
      dark={dark}
      options={(["DELIVERED","PARTIAL","FAILED","REJECTED"] as Outcome[]).map((value)=>({value,label:i18n.t(value.toLowerCase())}))}
      onChange={(value)=>{setChoice(value);setReason(null);setNote("");setError("")}}
    />
    {choice!=="DELIVERED"&&<ReasonCodeSelector reasons={reasonsQuery.data} selected={reason} note={note} loading={reasonsQuery.isLoading} error={reasonsQuery.isError} dark={dark} onSelect={item=>{setReason(item);setError("")}} onNoteChange={setNote} onRetry={()=>void reasonsQuery.refetch()}/>}
    {choice==="PARTIAL"&&<><Text style={[s.label,dark&&s.white]}>{i18n.t("actualCod")}</Text><TextInput accessibilityLabel={i18n.t("actualCod")} value={actualCod} onChangeText={setActualCod} keyboardType="number-pad" placeholder={i18n.t("actualCodPlaceholder")} placeholderTextColor="#94a3b8" style={[s.input,dark&&s.inputDark]}/><Text style={[s.label,dark&&s.white]}>{i18n.t("collectionWallet")}</Text><View style={s.wallets}>{(["CASH","KBZ_PAY","WAVE_PAY"] as const).map(wallet=><Pressable accessibilityRole="radio" accessibilityState={{selected:collectionWallet===wallet}} accessibilityLabel={i18n.t(wallet==="CASH"?"cash":wallet==="KBZ_PAY"?"kbzPay":"wavePay")} key={wallet} onPress={()=>setCollectionWallet(wallet)} style={[s.wallet,collectionWallet===wallet&&s.selected]}><Text style={[s.optionText,collectionWallet===wallet&&s.selectedText]}>{i18n.t(wallet==="CASH"?"cash":wallet==="KBZ_PAY"?"kbzPay":"wavePay")}</Text></Pressable>)}</View></>}
    {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={saving} onPress={confirmSave} style={[s.button,saving&&s.disabled]}><Text style={s.buttonText}>{saving?i18n.t("loading"):i18n.t("confirm")}</Text></Pressable>
    </>}
    </>}
  </ScrollView></SafeAreaView>
}

const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#f6f7f9"},dark:{backgroundColor:"#111315"},content:{padding:24},back:{color:"#1598ef",fontWeight:"800",marginBottom:30},kicker:{color:"#1598ef",fontSize:12,fontWeight:"800",letterSpacing:2},title:{fontSize:30,fontWeight:"800",marginTop:15},white:{color:"white"},muted:{color:"#64748b",marginTop:8},call:{alignSelf:"flex-start",minHeight:44,justifyContent:"center",marginTop:8,paddingHorizontal:14,borderRadius:12,backgroundColor:"#eaf6ff"},callText:{color:"#0878be",fontWeight:"800"},group:{marginTop:18,borderRadius:16,padding:16,backgroundColor:"#eaf6ff",borderWidth:1,borderColor:"#b8e2ff"},groupTitle:{fontWeight:"800",color:"#0878be"},groupText:{color:"#375b73",marginTop:4},selected:{backgroundColor:"#eaf6ff",borderColor:"#1598ef"},optionText:{fontWeight:"800",color:"#475569"},selectedText:{color:"#0787df"},label:{fontWeight:"800",marginTop:25,marginBottom:8},input:{backgroundColor:"white",padding:16,borderRadius:14},inputDark:{backgroundColor:"#1b1e22",color:"white"},wallets:{flexDirection:"row",gap:8},wallet:{flex:1,backgroundColor:"white",borderRadius:12,padding:12,borderWidth:1,borderColor:"transparent",alignItems:"center"},error:{color:"#dc2626",marginTop:14},retry:{alignSelf:"flex-start",marginTop:10,padding:12,backgroundColor:"#1598ef",borderRadius:12},retryText:{color:"white",fontWeight:"800"},button:{marginTop:30,backgroundColor:"#1598ef",borderRadius:15,padding:17,alignItems:"center"},disabled:{opacity:.6},buttonText:{color:"white",fontWeight:"800"}});
