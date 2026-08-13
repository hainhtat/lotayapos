import {Tabs} from "expo-router";
import {Text} from "react-native";
import {i18n} from "@/i18n";
import {useTheme} from "@/providers/theme";

export default function TabsLayout(){
  const {theme}=useTheme();const dark=theme==="dark";
  const options={tabBarActiveTintColor:"#1598ef",tabBarInactiveTintColor:dark?"#94a3b8":"#64748b",tabBarStyle:{backgroundColor:dark?"#17191d":"#ffffff",borderTopColor:dark?"#343a40":"#e2e8f0"},headerShown:false};
  return <Tabs screenOptions={options}>
    <Tabs.Screen name="index" options={{title:i18n.t("home"),tabBarIcon:({color})=><Text style={{color,fontSize:18}}>⌂</Text>}}/>
    <Tabs.Screen name="settlement" options={{title:i18n.t("settlement"),tabBarIcon:({color})=><Text style={{color,fontSize:18}}>▣</Text>}}/>
    <Tabs.Screen name="profile" options={{title:i18n.t("profile"),tabBarIcon:({color})=><Text style={{color,fontSize:18}}>●</Text>}}/>
    <Tabs.Screen name="settings" options={{title:i18n.t("settings"),tabBarIcon:({color})=><Text style={{color,fontSize:18}}>⚙</Text>}}/>
  </Tabs>;
}
