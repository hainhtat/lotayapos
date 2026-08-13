import {SafeAreaView,StyleSheet,Text,View} from "react-native";
import {i18n} from "@/i18n";
import {useAuth} from "@/providers/auth";
import {useTheme} from "@/providers/theme";

export default function Profile(){
  const {user}=useAuth();
  const {theme}=useTheme();
  const dark=theme==="dark";
  return <SafeAreaView style={[s.safe,dark&&s.dark]}><View style={s.content}>
    <Text style={[s.title,dark&&s.white]}>{i18n.t("profile")}</Text>
    <View style={[s.card,dark&&s.cardDark]}>
      <Text style={s.label}>{i18n.t("name")}</Text><Text style={[s.value,dark&&s.white]}>{user?.name??"—"}</Text>
      <Text style={s.label}>{i18n.t("email")}</Text><Text style={[s.value,dark&&s.white]}>{user?.email??"—"}</Text>
      <Text style={s.label}>{i18n.t("role")}</Text><Text style={[s.value,dark&&s.white]}>{user?.role??"—"}</Text>
    </View>
  </View></SafeAreaView>
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#f6f7f9"},dark:{backgroundColor:"#111315"},content:{padding:24},title:{fontSize:30,fontWeight:"800"},white:{color:"white"},card:{marginTop:24,padding:20,borderRadius:18,backgroundColor:"white"},cardDark:{backgroundColor:"#1b1e22"},label:{color:"#64748b",marginTop:10},value:{fontSize:17,fontWeight:"700",marginTop:4}});
