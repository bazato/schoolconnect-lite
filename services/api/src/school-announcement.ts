import { BadRequestException } from '@nestjs/common';
export function announcementText(body:Record<string,unknown>) {
  if(typeof body.title!=='string' || !body.title.trim() || body.title.trim().length>150 ||
    typeof body.body!=='string' || !body.body.trim() || body.body.trim().length>20000) throw new BadRequestException({code:'ANNOUNCEMENT_TITLE_AND_MESSAGE_REQUIRED'});
  return {title:body.title.trim(),body:body.body.trim()};
}
