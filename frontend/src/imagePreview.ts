export type ImagePreview = {image:string;width:number;height:number};
export function isImageFilename(name?:string|null){return /\.(jpe?g|png|webp|gif|avif|hei[cf]|bmp|tiff?)$/i.test(name||"");}
export function validImagePreview(value:unknown):value is ImagePreview {
  const data=value as ImagePreview|null;
  return !!data && typeof data.image==="string" && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.image) &&
    data.image.length<=660000 && Number.isInteger(data.width) && Number.isInteger(data.height) &&
    data.width>0 && data.height>0 && data.width<=1600 && data.height<=1600;
}
