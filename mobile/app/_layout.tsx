import {Stack} from "expo-router";
import {AppProviders} from "@/providers/app";
import {useAuth} from "@/providers/auth";
import {getAuthNavigationState} from "@/lib/auth-navigation";

function Routes(){
  const {user,loading}=useAuth();
  const state=getAuthNavigationState(loading,Boolean(user));
  if(state==="loading")return null;
  return <Stack screenOptions={{headerShown:false}}>
    <Stack.Protected guard={state==="anonymous"}><Stack.Screen name="login"/></Stack.Protected>
    <Stack.Protected guard={state==="authenticated"}><Stack.Screen name="(tabs)"/><Stack.Screen name="parcel"/></Stack.Protected>
  </Stack>;
}

export default function RootLayout(){return <AppProviders><Routes/></AppProviders>}
