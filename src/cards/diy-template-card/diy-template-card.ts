import { UnsubscribeFunc } from "home-assistant-js-websocket";

import {
  ActionConfig,
  actionHandler,
  ActionHandlerEvent,
  computeDomain,
  computeRTL,
  DOMAINS_TOGGLE,
  handleAction,
  hasAction,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  LovelaceLayoutOptions,
  RenderTemplateResult,
  subscribeRenderTemplate,
} from "../../ha";
import {
  css,
  CSSResultGroup,
  html,
  nothing,
  PropertyValues,
  TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import hash from "object-hash/dist/object_hash";
import "../../shared/shape-icon";
import "../../shared/state-info";
import "../../shared/state-item";
import { computeAppearance } from "../../utils/appearance";
import { MushroomBaseElement } from "../../utils/base-element";
import { cardStyle } from "../../utils/card-styles";
import { CacheManager } from "../../utils/cache-manager";

import { cardStyle } from "../../utils/card-styles";
import { computeRgbColor } from "../../utils/colors";
import { getWeatherSvgIcon } from "../../utils/icons/weather-icon";
import { weatherSVGStyles } from "../../utils/weather";
import { LegacyTemplateCardConfig } from "../legacy-template-card/legacy-template-card-config";


const templateCache = new CacheManager<TemplateResults>(1000);

type TemplateResults = Partial<
  Record<TemplateKey, RenderTemplateResult | undefined>
>;

const TEMPLATE_KEYS = [
  "icon",
  "icon_color",
  "badge_color",
  "badge_icon",
  "primary",
  "secondary",
  "picture",
] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];


const DIY_TEMPLATE_CARD_NAME = "mushroom-diy-template-card";
const DIY_TEMPLATE_CARD_EDITOR_NAME = "mushroom-template-card-editor";

export const getEntityDefaultTileIconAction = (entityId: string) => {
  const domain = computeDomain(entityId);
  const supportsIconAction =
    DOMAINS_TOGGLE.has(domain) ||
    ["button", "input_button", "scene"].includes(domain);

  return supportsIconAction ? "toggle" : "none";
};

type DiyTemplateCardConfig = LegacyTemplateCardConfig & {
  icon_tap_action?: ActionConfig;
  icon_hold_action?: ActionConfig;
  icon_double_tap_action?: ActionConfig;
};

@customElement(DIY_TEMPLATE_CARD_NAME)

export class MushroomDiyTemplateCard
  extends MushroomBaseElement
  implements LovelaceCard
{
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("../template-card/template-card-editor");
    return document.createElement(
      DIY_TEMPLATE_CARD_EDITOR_NAME
    ) as LovelaceCardEditor;
  }

  public static async getStubConfig(
    _hass: HomeAssistant
  ): Promise<DiyTemplateCardConfig> {
    return {
      type: `custom:${DIY_TEMPLATE_CARD_NAME}`,
      primary: "Hello, {{user}}",
      secondary: "How are you?",
      icon: "mdi:home",
    };
  }

  @state() private _config?: DiyTemplateCardConfig;

  @state() private _templateResults?: TemplateResults;

  @state() private _unsubRenderTemplates: Map<
    TemplateKey,
    Promise<UnsubscribeFunc>
  > = new Map();

  @property({ reflect: true, type: String })
  public layout: string | undefined;

  public getCardSize(): number | Promise<number> {
    let height = 1;
    if (!this._config) return height;

    const appearance = computeAppearance(this._config);

    if (appearance.layout === "vertical") {
      height += 1;
    }
    return height;
  }

  public getLayoutOptions(): LovelaceLayoutOptions {
    const options: LovelaceLayoutOptions = {
      grid_columns: 2,
      grid_rows: 1,
    };
    if (!this._config) return options;

    const appearance = computeAppearance(this._config);

    if (appearance.layout === "vertical") {
      options.grid_rows! += 1;
    }
    if (appearance.layout === "horizontal") {
      options.grid_columns = 4;
    }
    if (this._config?.multiline_secondary) {
      options.grid_rows = undefined;
    }
    return options;
  }

  // For HA < 2024.11
  public getGridOptions(): LovelaceGridOptions {

    // No min and max because the content can be dynamic

    const options: LovelaceGridOptions = {
      columns: 6,
      rows: 1,
    };
    if (!this._config) return options;

    const appearance = computeAppearance(this._config);

    if (appearance.layout === "vertical") {
      options.rows! += 1;
    }
    if (appearance.layout === "horizontal") {
      options.columns = 12;
    }
    if (this._config?.multiline_secondary) {
      options.rows = undefined;
    }
    return options;
  }

  setConfig(config: DiyTemplateCardConfig): void {
    TEMPLATE_KEYS.forEach((key) => {
      if (
        this._config?.[key] !== config[key] ||
        this._config?.entity != config.entity
      ) {
        this._tryDisconnectKey(key);
      }
    });
    this._config = {
      tap_action: {
        action: "toggle",
      },
      hold_action: {
        action: "more-info",
      },
      ...config,
    };

    if (this._config.entity && !this._config.icon_tap_action) {
      this._config.icon_tap_action = {
        action: getEntityDefaultTileIconAction(this._config.entity),
      };
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    this._tryConnect();
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    this._tryDisconnect();

    if (this._config && this._templateResults) {
      const key = this._computeCacheKey();
      templateCache.set(key, this._templateResults);
    }
  }

  public setConfig(config: TemplateCardConfig): void {
    const migratedConfig = migrateTemplateCardConfig(config);

    TEMPLATE_KEYS.forEach((key) => {
      if (
        this._config?.[key] !== migratedConfig[key] ||
        this._config?.entity != migratedConfig.entity
      ) {
        this._tryDisconnectKey(key);
      }
    });

    this._config = {
      tap_action: {
        action: "toggle",
      },
      hold_action: {
        action: "more-info",
      },
      ...migratedConfig,
    };

    if (this._config.entity && !this._config.icon_tap_action) {
      this._config.icon_tap_action = {
        action: getEntityDefaultTileIconAction(this._config.entity),
      };
    }
  }

  protected willUpdate(_changedProperties: PropertyValues): void {
    super.willUpdate(_changedProperties);
    if (!this._config) {
      return;
    }

    if (!this._templateResults) {
      const key = this._computeCacheKey();
      if (templateCache.has(key)) {
        this._templateResults = templateCache.get(key)!;
      } else {
        this._templateResults = {};
      }
    }
  }

  private _handleAction(ev: ActionHandlerEvent) {
    handleAction(this, this.hass!, this._config!, ev.detail.action!);
  }

  private _handleIconAction(ev: ActionHandlerEvent) {
    ev.stopPropagation();
    const config = {
      entity: this._config!.entity,
      tap_action: this._config!.icon_tap_action,
      hold_action: this._config!.icon_hold_action,
      double_tap_action: this._config!.icon_double_tap_action,
    };
    handleAction(this, this.hass!, config, ev.detail.action!);
  }

  public isTemplate(key: TemplateKey) {
    const value = this._config?.[key];
    return value?.includes("{");
  }

  private getValue(key: TemplateKey) {
    return this.isTemplate(key)
      ? this._templateResults?.[key]?.result?.toString()
      : this._config?.[key];
  }

  private get _hasIconAction() {
    return (
      hasAction(this._config?.icon_tap_action) ||
      hasAction(this._config?.icon_hold_action) ||
      hasAction(this._config?.icon_double_tap_action)
    );
  }

  protected render() {
    if (!this._config || !this.hass) {
      return nothing;
    }

    const icon = this.getValue("icon");
    const iconColor = this.getValue("icon_color");
    const badgeIcon = this.getValue("badge_icon");
    const badgeColor = this.getValue("badge_color");
    const primary = this.getValue("primary");
    const secondary = this.getValue("secondary");
    const picture = this.getValue("picture");

    const multiline_secondary = this._config.multiline_secondary;

    const rtl = computeRTL(this.hass);

    const appearance = computeAppearance({
      fill_container: this._config.fill_container,
      layout: this._config.layout,
      icon_type: Boolean(picture)
        ? "entity-picture"
        : Boolean(icon)
          ? "icon"
          : "none",
      primary_info: Boolean(primary) ? "name" : "none",
      secondary_info: Boolean(secondary) ? "state" : "none",
    });

    const weatherSvg = getWeatherSvgIcon(icon);

    return html`
      <ha-card
        class=${classMap({ "fill-container": appearance.fill_container })}
      >
        <mushroom-card .appearance=${appearance} ?rtl=${rtl}>
          <mushroom-state-item
            ?rtl=${rtl}
            .appearance=${appearance}
            @action=${this._handleAction}
            .actionHandler=${actionHandler({
              hasHold: hasAction(this._config.hold_action),
              hasDoubleClick: hasAction(this._config.double_tap_action),
            })}
          >
            ${picture
              ? this.renderPicture(picture)
              : weatherSvg
                ? html`
                    <div
                      slot="icon"
                      role=${ifDefined(this._hasIconAction ? "button" : undefined)}
                      tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
                      @action=${this._handleIconAction}
                      .actionHandler=${actionHandler({
                        disabled: !this._hasIconAction,
                        hasHold: hasAction(this._config?.icon_hold_action),
                        hasDoubleClick: hasAction(
                          this._config?.icon_double_tap_action
                        ),
                      })}
                    >
                      ${weatherSvg}
                    </div>
                  `
                : icon
                  ? this.renderIcon(icon, iconColor)
                  : nothing}
            ${(icon || picture) && badgeIcon
              ? this.renderBadgeIcon(badgeIcon, badgeColor)
              : undefined}
            <mushroom-state-info
              slot="info"
              .primary=${primary}
              .secondary=${secondary}
              .multiline_secondary=${multiline_secondary}
            ></mushroom-state-info>
          </mushroom-state-item>
        </mushroom-card>
      </ha-card>
    `;
  }

  renderPicture(picture: string): TemplateResult {
    return html`
      <mushroom-shape-avatar
        slot="icon"
        .picture_url=${(this.hass as any).hassUrl(picture)}
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      ></mushroom-shape-avatar>
    `;
  }

  renderIcon(icon: string, iconColor?: string) {
    const iconStyle = {};
    if (iconColor) {
      const iconRgbColor = computeRgbColor(iconColor);
      iconStyle["--icon-color"] = `rgb(${iconRgbColor})`;
      iconStyle["--shape-color"] = `rgba(${iconRgbColor}, 0.2)`;
    }
    return html`
      <mushroom-shape-icon
        style=${styleMap(iconStyle)}
        slot="icon"
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      >
        <ha-state-icon .hass=${this.hass} .icon=${icon}></ha-state-icon>
      </mushroom-shape-icon>
    `;
  }

  renderBadgeIcon(badge: string, badgeColor?: string) {
    const badgeStyle = {};
    if (badgeColor) {
      const iconRgbColor = computeRgbColor(badgeColor);
      badgeStyle["--main-color"] = `rgba(${iconRgbColor})`;
    }
    return html`
      <mushroom-badge-icon
        slot="badge"
        .icon=${badge}
        style=${styleMap(badgeStyle)}
      ></mushroom-badge-icon>
    `;
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!this._config || !this.hass) {
      return;
    }

    this._tryConnect();
  }


  private _handleAction(ev: ActionHandlerEvent) {
    handleAction(this, this.hass!, this._config!, ev.detail.action!);
  }

  private _handleIconAction(ev: CustomEvent) {
    ev.stopPropagation();
    const config = {
      entity: this._config!.entity,
      tap_action: this._config!.icon_tap_action,
      hold_action: this._config!.icon_hold_action,
      double_tap_action: this._config!.icon_double_tap_action,
    };
    handleAction(this, this.hass!, config, ev.detail.action!);
  }

  public isTemplate(key: TemplateKey) {
    const value = this._config?.[key];
    return value?.includes("{");
  }

  private getValue(key: TemplateKey) {
    return this.isTemplate(key)
      ? this._templateResults?.[key]?.result?.toString()
      : (this._config as any)?.[key];
  }

  private get _hasIconAction() {
    return (
      hasAction(this._config?.icon_tap_action) ||
      hasAction(this._config?.icon_hold_action) ||
      hasAction(this._config?.icon_double_tap_action)
    );
  }

  protected render() {
    if (!this._config || !this.hass) {
      return nothing;
    }

    const icon = this.getValue("icon");
    const iconColor = this.getValue("icon_color");
    const badgeIcon = this.getValue("badge_icon");
    const badgeColor = this.getValue("badge_color");
    const primary = this.getValue("primary");
    const secondary = this.getValue("secondary");
    const picture = this.getValue("picture");

    const multiline_secondary = this._config.multiline_secondary;

    const rtl = computeRTL(this.hass);

    const appearance = computeAppearance({
      fill_container: this._config.fill_container,
      layout: this._config.layout,
      icon_type: Boolean(picture)
        ? "entity-picture"
        : Boolean(icon)
          ? "icon"
          : "none",
      primary_info: Boolean(primary) ? "name" : "none",
      secondary_info: Boolean(secondary) ? "state" : "none",
    });

    const weatherSvg = getWeatherSvgIcon(icon);

    return html`
      <ha-card
        class=${classMap({ "fill-container": appearance.fill_container })}
      >
        <mushroom-card .appearance=${appearance} ?rtl=${rtl}>
          <mushroom-state-item
            ?rtl=${rtl}
            .appearance=${appearance}
            @action=${this._handleAction}
            .actionHandler=${actionHandler({
              hasHold: hasAction(this._config.hold_action),
              hasDoubleClick: hasAction(this._config.double_tap_action),
            })}
          >
            ${picture
              ? this.renderPicture(picture)
              : weatherSvg
                ? this.renderWeatherIcon(weatherSvg)
                : icon
                  ? this.renderIcon(icon, iconColor)
                  : nothing}
            ${(icon || picture) && badgeIcon
              ? this.renderBadgeIcon(badgeIcon, badgeColor)
              : undefined}
            <mushroom-state-info
              slot="info"
              .primary=${primary}
              .secondary=${secondary}
              .multiline_secondary=${multiline_secondary}
            ></mushroom-state-info>
          </mushroom-state-item>
        </mushroom-card>
      </ha-card>
    `;
  }

  renderPicture(picture: string): TemplateResult {
    return html`
      <mushroom-shape-avatar
        slot="icon"
        .picture_url=${(this.hass as any).hassUrl(picture)}
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      ></mushroom-shape-avatar>
    `;
  }

  renderIcon(icon: string, iconColor?: string) {
    const iconStyle = {} as Record<string, string>;
    if (iconColor) {
      const iconRgbColor = computeRgbColor(iconColor);
      iconStyle["--icon-color"] = `rgb(${iconRgbColor})`;
      iconStyle["--shape-color"] = `rgba(${iconRgbColor}, 0.2)`;
    }
    return html`
      <mushroom-shape-icon
        style=${styleMap(iconStyle)}
        slot="icon"
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      >
        <ha-state-icon .hass=${this.hass} .icon=${icon}></ha-state-icon>
      </mushroom-shape-icon>
    `;
  }

  renderBadgeIcon(badge: string, badgeColor?: string) {
    const badgeStyle = {} as Record<string, string>;
    if (badgeColor) {
      const iconRgbColor = computeRgbColor(badgeColor);
      badgeStyle["--main-color"] = `rgba(${iconRgbColor})`;
    }
    return html`
      <mushroom-badge-icon
        slot="badge"
        .icon=${badge}
        style=${styleMap(badgeStyle)}
      ></mushroom-badge-icon>
    `;
  }

  renderWeatherIcon(weatherSvg: TemplateResult): TemplateResult {
    return html`
      <div
        slot="icon"
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      >
        ${weatherSvg}
      </div>
    `;

  }

  private async _tryConnect(): Promise<void> {
    TEMPLATE_KEYS.forEach((key) => {
      this._tryConnectKey(key);
    });
  }

  private async _tryConnectKey(key: TemplateKey): Promise<void> {
    if (
      this._unsubRenderTemplates.get(key) !== undefined ||
      !this.hass ||
      !this._config ||
      !this.isTemplate(key)
    ) {
      return;
    }

    try {
      const sub = subscribeRenderTemplate(
        this.hass.connection,
        (result) => {
          this._templateResults = {
            ...this._templateResults,
            [key]: result,
          };
        },
        {
          template: this._config[key] ?? "",
          entity_ids: this._config.entity_id,
          variables: {
            config: this._config,
            user: this.hass.user!.name,
            entity: this._config.entity,
          },
          strict: true,
        }
      );
      this._unsubRenderTemplates.set(key, sub);
      await sub;
    } catch (_err) {
      const result = {
        result: value ?? "",
        listeners: {
          all: false,
          domains: [],
          entities: [],
          time: false,
        },
      };
      this._templateResults = {
        ...this._templateResults,
        [key]: result,
      };
      this._unsubRenderTemplates.delete(key);
    }
  }

  private async _tryDisconnect(): Promise<void> {
    TEMPLATE_KEYS.forEach((key) => {
      this._tryDisconnectKey(key);
    });
  }

  private async _tryDisconnectKey(key: TemplateKey): Promise<void> {
    const unsubRenderTemplate = this._unsubRenderTemplates.get(key);
    if (!unsubRenderTemplate) {
      return;
    }

    try {
      const unsub = await unsubRenderTemplate;
      unsub();
      this._unsubRenderTemplates.delete(key);
    } catch (err: any) {
      if (err.code === "not_found" || err.code === "template_error") {
        // If we get here, the connection was probably already closed. Ignore.
      } else {
        throw err;
      }
    }
  }


  static get styles(): CSSResultGroup {
    return [
      super.styles,
      cardStyle,
      css`
        mushroom-state-item {
          cursor: pointer;
        }
        mushroom-shape-icon {
          --icon-color: rgb(var(--rgb-disabled));
          --shape-color: rgba(var(--rgb-disabled), 0.2);

        }
        svg {
          width: var(--icon-size);
          height: var(--icon-size);
          display: flex;
        }
        ${weatherSVGStyles}
      `,
    ];
  }
}

