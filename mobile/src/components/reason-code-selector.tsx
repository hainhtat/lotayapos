import {Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import type {ReasonCode} from "@/lib/api";
import {i18n} from "@/i18n";

type Props={reasons?:ReasonCode[];selected:ReasonCode|null;note:string;loading:boolean;error:boolean;dark:boolean;onSelect:(reason:ReasonCode)=>void;onNoteChange:(note:string)=>void;onRetry:()=>void};
export function ReasonCodeSelector({reasons,selected,note,loading,error,dark,onSelect,onNoteChange,onRetry}:Props){return <View>
  <Text style={[s.label,dark&&s.white]}>{i18n.t("reasonCode")}</Text>
  {loading&&<Text style={s.muted}>{i18n.t("loading")}</Text>}
  {error&&<View><Text accessibilityRole="alert" style={s.error}>{i18n.t("reasonLoadError")}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={s.retry}><Text style={s.retryText}>{i18n.t("retry")}</Text></Pressable></View>}
  {!loading&&!error&&!reasons?.length&&<Text accessibilityRole="alert" style={s.error}>{i18n.t("reasonEmpty")}</Text>}
  {reasons?.map(item=><Pressable accessibilityRole="radio" accessibilityState={{selected:selected?.id===item.id}} accessibilityLabel={i18n.locale.startsWith("my")?item.labelMy:item.labelEn} key={item.id} onPress={()=>onSelect(item)} style={[s.reason,selected?.id===item.id&&s.selected]}><Text style={[s.optionText,selected?.id===item.id&&s.selectedText]}>{i18n.locale.startsWith("my")?item.labelMy:item.labelEn}</Text><Text style={s.reasonCode}>{item.code}</Text></Pressable>)}
  {selected?.noteRequired&&<><Text style={[s.label,dark&&s.white]}>{i18n.t("reasonNote")}</Text><TextInput accessibilityLabel={i18n.t("reasonNote")} value={note} onChangeText={onNoteChange} multiline placeholder={i18n.t("reasonNotePlaceholder")} placeholderTextColor="#94a3b8" style={[s.input,dark&&s.inputDark]}/></>}
</View>}
const s=StyleSheet.create({white:{color:"white"},muted:{color:"#64748b",marginTop:8},label:{fontWeight:"800",marginTop:25,marginBottom:8},error:{color:"#dc2626",marginTop:14},retry:{alignSelf:"flex-start",marginTop:10,padding:12,backgroundColor:"#1598ef",borderRadius:12},retryText:{color:"white",fontWeight:"800"},reason:{backgroundColor:"white",borderRadius:14,padding:15,borderWidth:1,borderColor:"transparent",marginTop:8},reasonCode:{color:"#64748b",fontSize:12,marginTop:3},selected:{backgroundColor:"#eaf6ff",borderColor:"#1598ef"},optionText:{fontWeight:"800",color:"#475569"},selectedText:{color:"#0787df"},input:{backgroundColor:"white",padding:16,borderRadius:14},inputDark:{backgroundColor:"#1b1e22",color:"white"}});
