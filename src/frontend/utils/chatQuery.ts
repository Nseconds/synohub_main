import { REQUESTED_PEOPLE } from "../constants/options";

export const normalizeQueryText = (text: string) => {
  return text
    .toLowerCase()
    .replace(/\b(pednig|pendng|pendig|penidng|pendign|pendingg)\b/g, "pending")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(acount|accout|accoount)\b/g, "account");
};

export const isSafeQueryMessage = (text: string) => {
  return false;
};
