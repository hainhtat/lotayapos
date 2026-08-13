import {requireVerifiedUser} from "./auth-response";
const user={id:"user-1",name:"Rider",email:"rider@example.com",role:"RIDER"};
describe("auth verification response",()=>{
  it("accepts the direct API data shape",()=>expect(requireVerifiedUser(user)).toEqual(user));
  it("rejects the obsolete nested user shape",()=>expect(()=>requireVerifiedUser({user})).toThrow("Invalid verification response"));
  it.each([
    {id:"",name:"Rider",email:"rider@example.com",role:"RIDER"},
    {id:"user-1",name:"Rider",email:"",role:"RIDER"},
    {id:"user-1",name:"Rider",email:"rider@example.com",role:""},
  ])("rejects incomplete verified user %j",incomplete=>{
    expect(()=>requireVerifiedUser(incomplete)).toThrow("Invalid verification response");
  });
});
