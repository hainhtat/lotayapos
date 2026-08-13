import {useState} from "react";
import {Pressable,SafeAreaView,StyleSheet,Text,View} from "react-native";
import {i18n,setLocale} from "@/i18n";
import {useAuth} from "@/providers/auth";
import {useTheme} from "@/providers/theme";

export default function Settings(){
  const {signOut}=useAuth();
  const {theme,toggle}=useTheme();
  const [locale,setLocaleState]=useState<"en"|"my">(i18n.locale.startsWith("my")?"my":"en");
  const [busy,setBusy]=useState(false);
  const chooseLocale=async(next:"en"|"my")=>{await setLocale(next);setLocaleState(next)};
  const logout=async()=>{setBusy(true);try{await signOut()}finally{setBusy(false)}};
  const dark=theme==="dark";
  return <SafeAreaView style={[s.safe,dark&&s.dark]}><View style={s.content}>
    <Text style={[s.title,dark&&s.white]}>{i18n.t("settings")}</Text>
    <Text style={s.label}>{i18n.t("language")}</Text><View style={s.row}>{(["en","my"] as const).map(value=><Pressable accessibilityRole="radio" accessibilityState={{selected:locale===value}} key={value} onPress={()=>void chooseLocale(value)} style={[s.choice,locale===value&&s.selected]}><Text style={locale===value?s.selectedText:undefined}>{value==="en"?"English":"မြန်မာ"}</Text></Pressable>)}</View>
    <Text style={s.label}>{i18n.t("theme")}</Text><Pressable accessibilityRole="button" onPress={toggle} style={s.action}><Text style={s.actionText}>{i18n.t(theme==="dark"?"light":"dark")}</Text></Pressable>
    <Text style={s.label}>{i18n.t("appVersion")}</Text><Text style={[s.version,dark&&s.white]}>0.1.0</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void logout()} style={[s.logout,busy&&s.disabled]}><Text style={s.logoutText}>{busy?i18n.t("loading"):i18n.t("logout")}</Text></Pressable>
  </View></SafeAreaView>
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#f6f7f9"},dark:{backgroundColor:"#111315"},content:{padding:24},title:{fontSize:30,fontWeight:"800"},white:{color:"white"},label:{color:"#64748b",fontWeight:"700",marginTop:28,marginBottom:10},row:{flexDirection:"row",gap:10},choice:{flex:1,padding:15,alignItems:"center",borderRadius:14,backgroundColor:"white",borderWidth:1,borderColor:"#e2e8f0"},selected:{borderColor:"#1598ef",backgroundColor:"#eaf6ff"},selectedText:{color:"#0878be",fontWeight:"800"},action:{alignSelf:"flex-start",backgroundColor:"#1598ef",borderRadius:14,paddingHorizontal:20,paddingVertical:14},actionText:{color:"white",fontWeight:"800"},version:{fontWeight:"700"},logout:{marginTop:40,borderWidth:1,borderColor:"#dc2626",borderRadius:14,padding:16,alignItems:"center"},logoutText:{color:"#dc2626",fontWeight:"800"},disabled:{opacity:.6}});
