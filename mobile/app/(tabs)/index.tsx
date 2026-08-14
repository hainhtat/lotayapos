import {useEffect,useMemo,useState} from "react";
import {Alert,Linking,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import {router} from "expo-router";
import {useQuery} from "@tanstack/react-query";
import {getAssignedParcels,type AssignedParcel} from "@/lib/api";
import {fetchRiderAppRelease,isNewerRelease} from "@/lib/app-release";
import {callCustomer,sanitizedCustomerPhone} from "@/lib/phone";
import {DATE_PRESETS,DELIVERY_FILTERS,datePresetRange,filterAndSortRoute,isUndeliveredParcel,parcelTownship,routeTownships,type DatePreset,type DeliveryFilter} from "@/lib/route-parcels";
import {i18n} from "@/i18n";
import {useTheme} from "@/providers/theme";

function money(value:number){
  return value.toLocaleString();
}

function statusLabel(status:string){
  const map:Record<string,string>={
    delivered:"delivered",
    partial:"partial",
    failed:"failed",
    rejected:"rejected",
    pending:"pending",
    assigned:"pending",
    out_for_delivery:"deliveryUpdate",
  };
  const key=map[status.toLowerCase()];
  return key?i18n.t(key):status.replaceAll("_"," ");
}

function ParcelCard({parcel,dark,onCall}:{parcel:AssignedParcel;dark:boolean;onCall:(phone?:string)=>void}){
  const total=parcel.codAmount+parcel.deliveryFee;
  const openStatus=()=>router.push({pathname:"/parcel",params:{id:parcel.id}});
  return (
    <View style={[s.row,dark&&s.rowDark]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${parcel.trackingNumber}, ${parcel.customerName}, ${parcel.status}`}
        onPress={openStatus}
        style={s.rowMain}
      >
        <Text style={[s.rowTitle,dark&&s.white]}>{parcel.orderId?.trim()||parcel.trackingNumber}</Text>
        <Text style={s.muted}>{parcel.customerName} · {statusLabel(parcel.status)}</Text>
        {parcel.orderId?.trim()?(
          <Text style={[s.detail,dark&&s.detailDark]}>{i18n.t("tracking")}: {parcel.trackingNumber}</Text>
        ):null}
        <Text style={[s.detail,dark&&s.detailDark]}>{i18n.t("cod")}: {money(parcel.codAmount)} MMK</Text>
        <Text style={[s.detail,dark&&s.detailDark]}>{i18n.t("deliveryFee")}: {money(parcel.deliveryFee)} MMK</Text>
        <Text style={[s.total,dark&&s.white]}>{i18n.t("totalAmount")}: {money(total)} MMK</Text>
        <Text style={[s.detail,dark&&s.detailDark]}>{i18n.t("address")}: {parcel.address}</Text>
        {parcel.linkedParcelGroupId?<Text style={s.group}>{i18n.t("linkedParcelCount",{count:parcel.linkedParcelCount??parcel.linkedParcelIds?.length??2})}</Text>:null}
      </Pressable>
      <View style={[s.actions,dark&&s.actionsDark]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={i18n.t("callCustomer",{name:parcel.customerName})}
          accessibilityHint={parcel.customerPhone??i18n.t("phoneMissing")}
          onPress={()=>onCall(parcel.customerPhone)}
          style={[s.actionButton,s.callButton]}
        >
          <Text style={s.callText}>☎ {i18n.t("call")}</Text>
        </Pressable>
        {isUndeliveredParcel(parcel)?(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={i18n.t("updateStatus")}
          onPress={openStatus}
          style={[s.actionButton,s.statusButton]}
        >
          <Text style={s.statusText}>{i18n.t("updateStatus")}</Text>
        </Pressable>
        ):null}
      </View>
    </View>
  );
}

export default function Home(){
  const {theme}=useTheme();
  const dark=theme==="dark";
  const [search,setSearch]=useState("");
  const [township,setTownship]=useState("");
  const [sortByTownship,setSortByTownship]=useState(true);
  const [deliveryFilter,setDeliveryFilter]=useState<DeliveryFilter>("toDeliver");
  const [datePreset,setDatePreset]=useState<DatePreset>("thisWeek");
  const dateRange=useMemo(()=>datePresetRange(datePreset),[datePreset]);
  const query=useQuery({
    queryKey:["assigned-parcels",dateRange.dateFrom,dateRange.dateTo],
    queryFn:()=>getAssignedParcels(dateRange),
  });
  const parcels=query.data??[];
  const townships=useMemo(()=>routeTownships(parcels,i18n.locale),[parcels]);
  const visible=useMemo(
    ()=>filterAndSortRoute(parcels,{search,township,sortByTownship,deliveryFilter,locale:i18n.locale}),
    [parcels,search,township,sortByTownship,deliveryFilter],
  );
  const heroLabel=deliveryFilter==="all"?"assigned":deliveryFilter;
  const dateLabel=datePreset==="today"?"dateToday":datePreset;
  const call=async(phone?:string)=>{
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

  useEffect(()=>{
    const url=process.env.EXPO_PUBLIC_RIDER_UPDATE_URL;
    if(!url)return;
    const current=Constants.expoConfig?.version??"0.0.0";
    void fetchRiderAppRelease(url).then((release)=>{
      if(!release||!isNewerRelease(current,release.version))return;
      Alert.alert(i18n.t("updateAvailableTitle"),i18n.t("updateAvailableBody",{version:release.version}),[
        {text:i18n.t("cancel"),style:"cancel"},
        {text:i18n.t("downloadUpdate"),onPress:()=>void Linking.openURL(release.apkUrl)},
      ]);
    });
  },[]);

  return (
    <SafeAreaView style={[s.safe,dark&&s.dark]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Text style={s.kicker}>LOTAYA RIDER</Text>
        <Text style={[s.title,dark&&s.white]}>{i18n.t("welcome")}</Text>
        <Text style={s.muted}>{i18n.t(dateLabel)}</Text>
        <View style={s.hero}>
          <Text style={s.heroLabel}>{i18n.t(heroLabel)}</Text>
          <Text style={s.heroValue}>{visible.length}</Text>
        </View>
        <View style={s.filterBlock}>
          <Text style={[s.sectionLabel,dark&&s.white]}>{i18n.t("deliveryFilter")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {DELIVERY_FILTERS.map((value)=>(
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{selected:deliveryFilter===value}}
                accessibilityLabel={i18n.t(value==="all"?"allParcels":value)}
                key={value}
                onPress={()=>setDeliveryFilter(value)}
                style={[s.chip,dark&&s.controlDark,deliveryFilter===value&&s.selected]}
              >
                <Text style={[s.chipText,dark&&s.white,deliveryFilter===value&&s.selectedText]}>
                  {i18n.t(value==="all"?"allParcels":value)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={s.filterBlock}>
          <Text style={[s.sectionLabel,dark&&s.white]}>{i18n.t("dateFilter")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {DATE_PRESETS.map((value)=>(
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{selected:datePreset===value}}
                accessibilityLabel={i18n.t(value==="today"?"dateToday":value)}
                key={value}
                onPress={()=>setDatePreset(value)}
                style={[s.chip,dark&&s.controlDark,datePreset===value&&s.selected]}
              >
                <Text style={[s.chipText,dark&&s.white,datePreset===value&&s.selectedText]}>
                  {i18n.t(value==="today"?"dateToday":value)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <TextInput
          accessibilityLabel={i18n.t("searchParcels")}
          value={search}
          onChangeText={setSearch}
          placeholder={i18n.t("searchParcels")}
          placeholderTextColor="#718096"
          style={[s.search,dark&&s.controlDark]}
        />
        <View style={s.sortRow}>
          <Text style={[s.sectionLabel,dark&&s.white]}>{i18n.t("township")}</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{checked:sortByTownship}}
            onPress={()=>setSortByTownship((value)=>!value)}
            style={[s.sortButton,sortByTownship&&s.selected]}
          >
            <Text style={sortByTownship?s.selectedText:s.mutedText}>{i18n.t("sortTownship")}</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {["",...townships].map((value)=>(
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{selected:township===value}}
              key={value||"all"}
              onPress={()=>setTownship(value)}
              style={[s.chip,dark&&s.controlDark,township===value&&s.selected]}
            >
              <Text style={[s.chipText,dark&&s.white,township===value&&s.selectedText]}>
                {value||i18n.t("allTownships")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {query.isLoading?<Text style={s.muted}>{i18n.t("loading")}</Text>:null}
        {query.isError?(
          <View>
            <Text accessibilityRole="alert" style={s.error}>{i18n.t("requestError")}</Text>
            <Pressable accessibilityRole="button" onPress={()=>void query.refetch()} style={s.retry}>
              <Text style={s.retryText}>{i18n.t("retry")}</Text>
            </Pressable>
          </View>
        ):null}
        {!query.isLoading&&!query.isError&&!parcels.length?<Text style={s.muted}>{i18n.t("empty")}</Text>:null}
        {!query.isLoading&&!query.isError&&parcels.length>0&&!visible.length?<Text style={s.muted}>{i18n.t("noRouteMatches")}</Text>:null}
        {visible.map((parcel,index)=>{
          const place=parcelTownship(parcel,i18n.locale);
          const showHeading=sortByTownship&&place&&(index===0||parcelTownship(visible[index-1]!,i18n.locale)!==place);
          return (
            <View key={parcel.id}>
              {showHeading?<Text style={[s.townshipHeading,dark&&s.white]}>{place}</Text>:null}
              <ParcelCard parcel={parcel} dark={dark} onCall={(phone)=>void call(phone)} />
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:"#f6f7f9"},
  dark:{backgroundColor:"#111315"},
  content:{padding:20,paddingBottom:40},
  kicker:{color:"#1598ef",fontWeight:"800",letterSpacing:2},
  title:{fontSize:30,fontWeight:"800",marginTop:14},
  white:{color:"white"},
  muted:{color:"#718096",marginTop:6},
  mutedText:{color:"#475569",fontWeight:"700"},
  error:{color:"#dc2626",marginTop:8},
  retry:{alignSelf:"flex-start",marginTop:12,borderRadius:12,backgroundColor:"#1598ef",paddingHorizontal:18,paddingVertical:12},
  retryText:{color:"white",fontWeight:"800"},
  hero:{marginTop:24,borderRadius:22,backgroundColor:"#101318",padding:20},
  heroLabel:{color:"#a5b0bb"},
  heroValue:{color:"white",fontSize:42,fontWeight:"800",marginTop:6},
  filterBlock:{marginTop:18},
  search:{marginTop:18,backgroundColor:"white",borderRadius:14,paddingHorizontal:16,paddingVertical:14,color:"#111827",borderWidth:1,borderColor:"#dbe2ea"},
  controlDark:{backgroundColor:"#1b1e22",color:"white",borderColor:"#343a40"},
  sortRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:18},
  sectionLabel:{fontWeight:"800",fontSize:16},
  sortButton:{minHeight:44,justifyContent:"center",borderRadius:22,paddingHorizontal:14,borderWidth:1,borderColor:"#cbd5e1",backgroundColor:"white"},
  selected:{backgroundColor:"#eaf6ff",borderColor:"#1598ef"},
  selectedText:{color:"#0878be",fontWeight:"800"},
  chips:{gap:8,paddingVertical:10},
  chip:{minHeight:42,justifyContent:"center",paddingHorizontal:14,borderRadius:21,backgroundColor:"white",borderWidth:1,borderColor:"#dbe2ea"},
  chipText:{color:"#334155",fontWeight:"700"},
  townshipHeading:{fontWeight:"800",fontSize:18,marginTop:18,marginBottom:2},
  row:{backgroundColor:"white",borderRadius:18,marginTop:10,overflow:"hidden"},
  rowDark:{backgroundColor:"#1b1e22"},
  rowMain:{padding:16,paddingBottom:12},
  rowTitle:{fontWeight:"800",fontSize:16},
  detail:{color:"#64748b",marginTop:6,lineHeight:20},
  detailDark:{color:"#94a3b8"},
  total:{color:"#0f172a",fontWeight:"800",marginTop:8},
  group:{color:"#0878be",fontWeight:"700",marginTop:8},
  actions:{flexDirection:"row",borderTopWidth:1,borderTopColor:"#dbe2ea"},
  actionsDark:{borderTopColor:"#2a2f35"},
  actionButton:{flex:1,minHeight:48,alignItems:"center",justifyContent:"center"},
  callButton:{borderRightWidth:1,borderRightColor:"#dbe2ea"},
  callText:{color:"#0878be",fontWeight:"800"},
  statusButton:{backgroundColor:"#1598ef"},
  statusText:{color:"white",fontWeight:"800"},
});
