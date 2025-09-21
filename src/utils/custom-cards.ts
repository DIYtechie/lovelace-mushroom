import { repository, version } from "../../package.json";

interface RegisterCardParams {
  type: string;
  name: string;
  description: string;
}

declare global {
  interface Window {
    customCards?: unknown[];
    mushroomDIYVersion?: string;
  }
}

export function registerCustomCard(params: RegisterCardParams) {
  window.customCards = window.customCards || [];

  if (!window.mushroomDIYVersion) {
    window.mushroomDIYVersion = version;
  }

  const cardPage = params.type.replace("-card", "").replace("mushroom-", "");
  window.customCards.push({
    ...params,
    preview: true,
    version,
    documentationURL: `${repository.url}/blob/main/docs/cards/${cardPage}.md`,
  });
}
