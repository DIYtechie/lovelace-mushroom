import { UnsubscribeFunc } from "home-assistant-js-websocket";
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
import {
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
import { isTemplate } from "../../ha/common/string/has-template";
import "../../shared/badge-icon";
import "../../shared/card";
import "../../shared/shape-avatar";
import "../../shared/shape-icon";
import "../../shared/state-info";
import "../../shared/state-item";
import { computeAppearance } from "../../utils/appearance";
import { MushroomBaseElement } from "../../utils/base-element";
import { cardStyle } from "../../utils/card-styles";
import { CacheManager } from "../../utils/cache-manager";
import { computeRgbColor } from "../../utils/colors";
import { registerCustomCard } from "../../utils/custom-cards";
import { getWeatherSvgIcon } from "../../utils/icons/weather-icon";
import { weatherSVGStyles } from "../../utils/weather";
import {
  migrateTemplateCardConfig,
  TemplateCardConfig,
} from "../template-card/template-card-config";

export const getEntityDefaultTileIconAction = (entityId: string) => {
  const domain = computeDomain(entityId);
  const supportsIconAction =
    DOMAINS_TOGGLE.has(domain) ||
    ["button", "input_button", "scene"].includes(domain);

  return supportsIconAction ? "toggle" : "none";
};

registerCustomCard({
  type: "mushroom-diy-template-card",
  name: "Mushroom DIY Template",
  description: "Template-based card that respects Mushroom theming variables",
});

const templateCache = new CacheManager<TemplateResults>(1000);

type TemplateResults = Partial<
  Record<TemplateKey, RenderTemplateResult | undefined>
>;

const TEMPLATE_KEYS = [
  "icon",
  "color",
  "icon_color",
  "badge_icon",
  "badge_color",
  "primary",
  "secondary",
  "picture",
] as const;

type TemplateKey = (typeof TEMPLATE_KEYS)[number];

@customElement("mushroom-diy-template-card")
export class MushroomDiyTemplateCard
  extends MushroomBaseElement
  implements LovelaceCard
{
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("../template-card/template-card-editor");
    return document.createElement(
      "mushroom-template-card-editor"
    ) as LovelaceCardEditor;
  }

  public static getStubConfig(): TemplateCardConfig {
    return {
      type: `custom:mushroom-diy-template-card`,
      primary: "Hello, {{user}}",
      secondary: "How are you?",
      icon: "mdi:mushroom",
    };
  }

  @state() private _config?: TemplateCardConfig;

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
    const appearance = this._computeAppearance(this._config);
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
    const appearance = this._computeAppearance(this._config);
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
    const options: LovelaceGridOptions = {
      columns: 6,
      rows: 1,
    };
    if (!this._config) return options;
    const appearance = this._computeAppearance(this._config);
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

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!this._config || !this.hass) {
      return;
    }

    this._tryConnect();
  }

  private _computeAppearance(config: TemplateCardConfig) {
    const layout = config.vertical
      ? "vertical"
      : config.layout === "horizontal" ||
          config.layout === "vertical" ||
          config.layout === "default"
        ? config.layout
        : undefined;
    return computeAppearance({
      fill_container: config.fill_container,
      layout,
      vertical: config.vertical,
      icon_type: config.picture
        ? "entity-picture"
        : config.icon
          ? "icon"
          : "none",
      primary_info: config.primary ? "name" : "none",
      secondary_info: config.secondary ? "state" : "none",
    });
  }

  private _computeCacheKey() {
    return hash(this._config);
  }

  private _getTemplateKeyValue(key: TemplateKey): string {
    if (!this._config) {
      return "";
    }
    return (this._config as any)[key] ?? "";
  }

  private getValue(key: TemplateKey) {
    const value = this._getTemplateKeyValue(key);
    return isTemplate(value)
      ? this._templateResults?.[key]?.result?.toString()
      : value;
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
      !this._config
    ) {
      return;
    }

    const value = this._getTemplateKeyValue(key);
    if (!isTemplate(value)) {
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
          template: value,
          entity_ids: this._config.entity_id,
          variables: {
            config: this._config,
            user: this.hass.user!.name,
            entity: this._config.entity,
            area: this._config.area,
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

  private get _hasCardAction() {
    return (
      hasAction(this._config?.tap_action) ||
      hasAction(this._config?.hold_action) ||
      hasAction(this._config?.double_tap_action)
    );
  }

  private get _hasIconAction() {
    return (
      hasAction(this._config?.icon_tap_action) ||
      hasAction(this._config?.icon_hold_action) ||
      hasAction(this._config?.icon_double_tap_action)
    );
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) {
      return nothing;
    }

    const icon = this.getValue("icon");
    const color = this.getValue("color") || this.getValue("icon_color");
    const badgeIcon = this.getValue("badge_icon");
    const badgeColor = this.getValue("badge_color");
    const primary = this.getValue("primary");
    const secondary = this.getValue("secondary");
    const picture = this.getValue("picture");

    const multilineSecondary = this._config.multiline_secondary;

    const rtl = computeRTL(this.hass);

    const appearance = this._computeAppearance({
      ...this._config,
      icon,
      picture,
      primary,
      secondary,
    });

    const weatherSvg = icon ? getWeatherSvgIcon(icon) : undefined;
    const stateItemClasses = classMap({ actionable: this._hasCardAction });

    return html`
      <ha-card
        class=${classMap({ "fill-container": appearance.fill_container })}
      >
        <mushroom-card .appearance=${appearance} ?rtl=${rtl}>
          <mushroom-state-item
            class=${stateItemClasses}
            ?rtl=${rtl}
            .appearance=${appearance}
            @action=${this._handleAction}
            .actionHandler=${actionHandler({
              disabled: !this._hasCardAction,
              hasHold: hasAction(this._config?.hold_action),
              hasDoubleClick: hasAction(this._config?.double_tap_action),
            })}
            role=${ifDefined(this._hasCardAction ? "button" : undefined)}
            tabindex=${ifDefined(this._hasCardAction ? "0" : undefined)}
          >
            ${picture
              ? this.renderPicture(picture)
              : weatherSvg
                ? this.renderWeatherIcon(weatherSvg)
                : icon
                  ? this.renderIcon(icon, color)
                  : nothing}
            ${(icon || picture) && badgeIcon
              ? this.renderBadgeIcon(badgeIcon, badgeColor)
              : nothing}
            <mushroom-state-info
              slot="info"
              .primary=${primary}
              .secondary=${secondary}
              .multiline_secondary=${multilineSecondary}
            ></mushroom-state-info>
          </mushroom-state-item>
        </mushroom-card>
      </ha-card>
    `;
  }

  private renderPicture(picture: string): TemplateResult {
    return this._renderIconWrapper(
      html`
        <mushroom-shape-avatar
          .picture_url=${(this.hass as any).hassUrl(picture)}
        ></mushroom-shape-avatar>
      `,
      "picture"
    );
  }

  private renderWeatherIcon(weatherSvg: TemplateResult): TemplateResult {
    return this._renderIconWrapper(html`<div class="weather-icon">
      ${weatherSvg}
    </div>`);
  }

  private renderIcon(icon: string, iconColor?: string | undefined) {
    const iconStyle: Record<string, string> = {};
    if (iconColor) {
      const iconRgbColor = computeRgbColor(iconColor);
      iconStyle["--icon-color"] = `rgb(${iconRgbColor})`;
      iconStyle["--shape-color"] = `rgba(${iconRgbColor}, 0.2)`;
    }
    return this._renderIconWrapper(html`
      <mushroom-shape-icon style=${styleMap(iconStyle)}>
        <ha-state-icon .hass=${this.hass} .icon=${icon}></ha-state-icon>
      </mushroom-shape-icon>
    `);
  }

  private renderBadgeIcon(badge: string, badgeColor?: string) {
    const badgeStyle: Record<string, string> = {};
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

  private _renderIconWrapper(content: TemplateResult, type?: string) {
    const classes = {
      "icon-container": true,
      interactive: this._hasIconAction,
    } as Record<string, boolean>;
    if (type) {
      classes[type] = true;
    }
    return html`
      <div
        slot="icon"
        class=${classMap(classes)}
        role=${ifDefined(this._hasIconAction ? "button" : undefined)}
        tabindex=${ifDefined(this._hasIconAction ? "0" : undefined)}
        @action=${this._handleIconAction}
        .actionHandler=${actionHandler({
          disabled: !this._hasIconAction,
          hasHold: hasAction(this._config?.icon_hold_action),
          hasDoubleClick: hasAction(this._config?.icon_double_tap_action),
        })}
      >
        ${content}
      </div>
    `;
  }

  static get styles(): CSSResultGroup {
    return [
      super.styles,
      cardStyle,
      css`
        mushroom-state-item {
          cursor: default;
        }
        mushroom-state-item.actionable {
          cursor: pointer;
        }
        .icon-container {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          outline: none;
        }
        .icon-container.interactive {
          cursor: pointer;
        }
        .icon-container:focus-visible {
          box-shadow: 0 0 0 2px
            var(--outline-color, var(--primary-color, currentColor));
          border-radius: var(--icon-border-radius);
        }
        .icon-container.picture:focus-visible {
          border-radius: var(--avatar-border-radius);
        }
        .icon-container :is(mushroom-shape-icon, mushroom-shape-avatar) {
          pointer-events: none;
        }
        .weather-icon {
          display: flex;
          pointer-events: none;
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

declare global {
  interface HTMLElementTagNameMap {
    "mushroom-diy-template-card": MushroomDiyTemplateCard;
  }
}
