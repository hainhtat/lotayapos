export const HUB_TIMEZONE="Asia/Yangon";

export function hubCalendarDate(date=new Date()){
  return new Intl.DateTimeFormat("en-CA",{timeZone:HUB_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
