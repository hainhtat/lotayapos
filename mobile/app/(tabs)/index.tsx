import {useMemo,useState} from "react";
import {Alert,Linking,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {router} from "expo-router";
import {useQuery} from "@tanstack/react-query";
import {getAssignedParcels} from "@/lib/api";
import {callCustomer} from "@/lib/phone";
import {filterAndSortRoute,parcelTownship,routeTownships} from "@/lib/route-parcels";
import {i18n} from "@/i18n";
import {useTheme} from "@/providers/theme";

export default function Home(){
  const {theme}=useTheme();const dark=theme==="dark";
  const query=useQuery({queryKey:["assigned-parcels"],queryFn:getAssignedParcels});
  const [search,setSearch]=useState("");const [township,setTownship]=useState("");const [sortByTownship,setSortByTownship]=useState(true);
  const parcels=query.data??[];const townships=useMemo(()=>routeTownships(parcels,i18n.locale),[parcels]);
  const visible=useMemo(()=>filterAndSortRoute(parcels,{search,township,sortByTownship,locale:i18n.locale}),[parcels,search,township,sortByTownship]);
  const call=async(phone?:string)=>{const result=await callCustomer(phone,Linking);if(result!=="opened")Alert.alert(i18n.t("callUnavailableTitle"),i18n.t(result==="missing"?"phoneMissing":"callUnavailable"))};
  return <SafeAreaView style={[s.safe,dark&&s.dark]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Text style={s.kicker}>LOTAYA RIDER</Text><Text style={[s.title,dark&&s.white]}>{i18n.t("welcome")}</Text><Text style={s.muted}>{i18n.t("today")}</Text>
    <View style={s.hero}><Text style={s.heroLabel}>{i18n.t("assigned")}</Text><Text style={s.heroValue}>{parcels.length}</Text></View>
    <TextInput accessibilityLabel={i18n.t("searchParcels")} value={search} onChangeText={setSearch} placeholder={i18n.t("searchParcels")} placeholderTextColor="#718096" style={[s.search,dark&&s.controlDark]}/>
    <View style={s.sortRow}><Text style={[s.sectionLabel,dark&&s.white]}>{i18n.t("township")}</Text><Pressable accessibilityRole="switch" accessibilityState={{checked:sortByTownship}} onPress={()=>setSortByTownship(value=>!value)} style={[s.sortButton,sortByTownship&&s.selected]}><Text style={sortByTownship?s.selectedText:s.mutedText}>{i18n.t("sortTownship")}</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {["",...townships].map(value=><Pressable accessibilityRole="radio" accessibilityState={{selected:township===value}} key={value||"all"} onPress={()=>setTownship(value)} style={[s.chip,dark&&s.controlDark,township===value&&s.selected]}><Text style={[s.chipText,dark&&s.white,township===value&&s.selectedText]}>{value||i18n.t("allTownships")}</Text></Pressable>)}
    </ScrollView>
    {query.isLoading&&<Text style={s.muted}>{i18n.t("loading")}</Text>}
    {query.isError&&<View><Text accessibilityRole="alert" style={s.error}>{i18n.t("requestError")}</Text><Pressable accessibilityRole="button" onPress={()=>void query.refetch()} style={s.retry}><Text style={s.retryText}>{i18n.t("retry")}</Text></Pressable></View>}
    {!query.isLoading&&!query.isError&&!parcels.length&&<Text style={s.muted}>{i18n.t("empty")}</Text>}
    {!query.isLoading&&!query.isError&&parcels.length>0&&!visible.length&&<Text style={s.muted}>{i18n.t("noRouteMatches")}</Text>}
    {visible.map((parcel,index)=>{const place=parcelTownship(parcel,i18n.locale);const showHeading=sortByTownship&&place&&(index===0||parcelTownship(visible[index-1],i18n.locale)!==place);return <View key={parcel.id}>
      {showHeading&&<Text style={[s.townshipHeading,dark&&s.white]}>{place}</Text>}
      <View style={[s.row,dark&&s.rowDark]}><Pressable accessibilityRole="button" accessibilityLabel={`${parcel.trackingNumber}, ${parcel.customerName}, ${parcel.status}`} onPress={()=>router.push({pathname:"/parcel",params:{id:parcel.id}})} style={s.rowMain}><Text style={[s.rowTitle,dark&&s.white]}>{parcel.trackingNumber}</Text><Text style={s.muted}>{parcel.customerName} · {parcel.status}</Text><Text numberOfLines={2} style={s.muted}>{parcel.address}</Text>{parcel.linkedParcelGroupId&&<Text style={s.group}>{i18n.t("linkedParcelCount",{count:parcel.linkedParcelCount??parcel.linkedParcelIds?.length??2})}</Text>}</Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={i18n.t("callCustomer",{name:parcel.customerName})} accessibilityHint={parcel.customerPhone??i18n.t("phoneMissing")} onPress={()=>void call(parcel.customerPhone)} style={s.call}><Text style={s.callText}>☎ {i18n.t("call")}</Text></Pressable></View>
    </View>})}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#f6f7f9"},dark:{backgroundColor:"#111315"},content:{padding:20,paddingBottom:40},kicker:{color:"#1598ef",fontWeight:"800",letterSpacing:2},title:{fontSize:30,fontWeight:"800",marginTop:14},white:{color:"white"},muted:{color:"#718096",marginTop:6},mutedText:{color:"#475569",fontWeight:"700"},error:{color:"#dc2626",marginTop:8},retry:{alignSelf:"flex-start",marginTop:12,borderRadius:12,backgroundColor:"#1598ef",paddingHorizontal:18,paddingVertical:12},retryText:{color:"white",fontWeight:"800"},hero:{marginTop:24,borderRadius:22,backgroundColor:"#101318",padding:20},heroLabel:{color:"#a5b0bb"},heroValue:{color:"white",fontSize:42,fontWeight:"800",marginTop:6},search:{marginTop:18,backgroundColor:"white",borderRadius:14,paddingHorizontal:16,paddingVertical:14,color:"#111827",borderWidth:1,borderColor:"#dbe2ea"},controlDark:{backgroundColor:"#1b1e22",color:"white",borderColor:"#343a40"},sortRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:18},sectionLabel:{fontWeight:"800",fontSize:16},sortButton:{minHeight:44,justifyContent:"center",borderRadius:22,paddingHorizontal:14,borderWidth:1,borderColor:"#cbd5e1",backgroundColor:"white"},selected:{backgroundColor:"#eaf6ff",borderColor:"#1598ef"},selectedText:{color:"#0878be",fontWeight:"800"},chips:{gap:8,paddingVertical:12},chip:{minHeight:42,justifyContent:"center",paddingHorizontal:14,borderRadius:21,backgroundColor:"white",borderWidth:1,borderColor:"#dbe2ea"},chipText:{color:"#334155",fontWeight:"700"},townshipHeading:{fontWeight:"800",fontSize:18,marginTop:18,marginBottom:2},row:{backgroundColor:"white",borderRadius:18,marginTop:10,overflow:"hidden"},rowDark:{backgroundColor:"#1b1e22"},rowMain:{padding:16,paddingBottom:12},rowTitle:{fontWeight:"800"},group:{color:"#0878be",fontWeight:"700",marginTop:8},call:{minHeight:48,alignItems:"center",justifyContent:"center",borderTopWidth:1,borderTopColor:"#dbe2ea"},callText:{color:"#0878be",fontWeight:"800"}});
