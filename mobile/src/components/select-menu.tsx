import {useState} from "react";
import {Modal,Pressable,StyleSheet,Text,View} from "react-native";

export type SelectOption<T extends string>={value:T;label:string};

export function SelectMenu<T extends string>({
  label,
  value,
  options,
  dark,
  onChange,
}:{
  label:string;
  value:T;
  options:SelectOption<T>[];
  dark:boolean;
  onChange:(value:T)=>void;
}){
  const [open,setOpen]=useState(false);
  const selected=options.find((option)=>option.value===value);
  return (
    <View>
      <Text style={[s.label,dark&&s.white]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={selected?.label}
        onPress={()=>setOpen(true)}
        style={[s.trigger,dark&&s.triggerDark]}
      >
        <Text style={[s.triggerText,dark&&s.white]}>{selected?.label??value}</Text>
        <Text style={[s.chevron,dark&&s.white]}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} style={s.overlay} onPress={()=>setOpen(false)}>
          <View style={[s.sheet,dark&&s.sheetDark]}>
            {options.map((option)=>(
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{selected:option.value===value}}
                key={option.value}
                onPress={()=>{onChange(option.value);setOpen(false)}}
                style={[s.option,option.value===value&&s.selected]}
              >
                <Text style={[s.optionText,option.value===value&&s.selectedText]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s=StyleSheet.create({
  label:{fontWeight:"800",marginTop:25,marginBottom:8},
  white:{color:"white"},
  trigger:{minHeight:52,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"white",borderRadius:16,paddingHorizontal:18,borderWidth:1,borderColor:"#dbe2ea"},
  triggerDark:{backgroundColor:"#1b1e22",borderColor:"#343a40"},
  triggerText:{fontWeight:"800",color:"#0f172a"},
  chevron:{fontSize:18,color:"#64748b"},
  overlay:{flex:1,backgroundColor:"rgba(15,23,42,0.45)",justifyContent:"center",padding:24},
  sheet:{backgroundColor:"white",borderRadius:18,padding:8},
  sheetDark:{backgroundColor:"#1b1e22"},
  option:{minHeight:48,justifyContent:"center",borderRadius:14,paddingHorizontal:16},
  selected:{backgroundColor:"#eaf6ff"},
  optionText:{fontWeight:"800",color:"#475569"},
  selectedText:{color:"#0787df"},
});
