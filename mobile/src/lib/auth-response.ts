import type {User} from "@/providers/auth";
export function requireVerifiedUser(data:unknown):User{
  if(typeof data!=="object"||data===null)throw new Error("Invalid verification response");
  const user=data as Partial<User>;
  if(!user.id||!user.name||!user.email||!user.role)throw new Error("Invalid verification response");
  return user as User;
}

export function requireRiderUser(data:unknown):User{
  const user=requireVerifiedUser(data);
  if(user.role!=="RIDER")throw new Error("RIDER_ROLE_REQUIRED");
  return user;
}
