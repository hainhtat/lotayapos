import {useEffect,useState} from "react";
import {KeyboardAvoidingView,Platform,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {Controller,useForm} from "react-hook-form";
import {router} from "expo-router";
import {useAuth} from "@/providers/auth";
import {useTheme} from "@/providers/theme";
import {getRememberedIdentifier} from "@/lib/session-store";
import {i18n} from "@/i18n";

type LoginFields={identifier:string;password:string};

export default function Login(){
  const {signIn}=useAuth();
  const {theme}=useTheme();
  const dark=theme==="dark";
  const [error,setError]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [remember,setRemember]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const {control,handleSubmit,setValue}=useForm<LoginFields>({defaultValues:{identifier:"",password:""}});

  useEffect(()=>{
    let active=true;
    void getRememberedIdentifier().then((value)=>{
      if(active&&value){
        setValue("identifier",value);
        setRemember(true);
      }
    });
    return()=>{active=false};
  },[setValue]);

  const submit=async(values:LoginFields)=>{
    const identifier=values.identifier.trim();
    if(!identifier){setError(i18n.t("identifierRequired"));return;}
    if(!values.password){setError(i18n.t("passwordRequired"));return;}
    try{
      setSubmitting(true);
      setError("");
      await signIn(identifier,values.password,remember);
      router.replace("/(tabs)");
    }catch(e){
      setError(e instanceof Error?e.message:i18n.t("loginError"));
    }finally{
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView testID="login-screen" style={[s.safe,dark&&s.dark]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS==="ios"?"padding":undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.wrap}>
          <Text style={s.kicker}>LOTAYA RIDER</Text>
          <Text style={[s.title,dark&&s.white]}>{i18n.t("welcomeBack")}</Text>
          <Text style={s.muted}>{i18n.t("signInPrompt")}</Text>
          <Controller
            control={control}
            name="identifier"
            render={({field})=>(
              <TextInput
                accessibilityLabel={i18n.t("identifier")}
                placeholder={i18n.t("identifier")}
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                value={field.value}
                onChangeText={field.onChange}
                style={[s.input,dark&&s.inputDark]}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({field})=>(
              <View style={[s.passwordRow,dark&&s.inputDark]}>
                <TextInput
                  accessibilityLabel={i18n.t("password")}
                  placeholder={i18n.t("password")}
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  value={field.value}
                  onChangeText={field.onChange}
                  style={[s.passwordInput,dark&&s.white]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={i18n.t(showPassword?"hidePassword":"showPassword")}
                  onPress={()=>setShowPassword((value)=>!value)}
                >
                  <Text style={s.show}>{i18n.t(showPassword?"hide":"show")}</Text>
                </Pressable>
              </View>
            )}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{checked:remember}}
            accessibilityLabel={i18n.t("rememberMe")}
            onPress={()=>setRemember((value)=>!value)}
            style={s.remember}
          >
            <View style={[s.box,remember&&s.boxChecked]}>
              {remember?<Text style={s.check}>{"\u2713"}</Text>:null}
            </View>
            <Text style={[s.rememberText,dark&&s.white]}>{i18n.t("rememberMe")}</Text>
          </Pressable>
          {error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={handleSubmit(submit)}
            style={[s.button,submitting&&s.disabled]}
          >
            <Text style={s.buttonText}>{submitting?i18n.t("loading"):i18n.t("signIn")}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:"#f6f7f9"},
  flex:{flex:1},
  dark:{backgroundColor:"#111315"},
  wrap:{flexGrow:1,padding:28,justifyContent:"center"},
  kicker:{color:"#1598ef",fontWeight:"800",letterSpacing:2},
  title:{fontSize:34,fontWeight:"800",marginTop:18},
  white:{color:"white"},
  muted:{color:"#64748b",marginTop:8,marginBottom:30},
  input:{backgroundColor:"white",borderRadius:14,padding:16,marginBottom:12},
  inputDark:{backgroundColor:"#1b1e22",color:"white"},
  passwordRow:{backgroundColor:"white",borderRadius:14,marginBottom:12,flexDirection:"row",alignItems:"center"},
  passwordInput:{flex:1,minWidth:0,padding:16},
  show:{color:"#0878be",fontWeight:"800",padding:14},
  remember:{flexDirection:"row",alignItems:"center",alignSelf:"flex-start",paddingVertical:8},
  box:{width:22,height:22,borderWidth:1,borderColor:"#94a3b8",borderRadius:6,alignItems:"center",justifyContent:"center"},
  boxChecked:{backgroundColor:"#1598ef",borderColor:"#1598ef"},
  check:{color:"white",fontWeight:"900"},
  rememberText:{marginLeft:9,fontWeight:"700",flexShrink:1},
  error:{color:"#dc2626",marginTop:10},
  button:{backgroundColor:"#1598ef",padding:17,borderRadius:14,alignItems:"center",marginTop:16},
  disabled:{opacity:0.6},
  buttonText:{color:"white",fontWeight:"800"},
});
