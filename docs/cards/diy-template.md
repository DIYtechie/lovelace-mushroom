# DIY Template Card

The **DIY Template Card** exposes the same templating-driven configuration as the standard
[Template Card](./template.md) while inheriting the Mushroom layout variables used by the legacy
implementation. Use it when you want the modern features—inline card features, icon actions, and
color templates—but need your dashboard spacing, typography, and icon treatments to respond to the
`--mush-*` theming tokens defined by classic Mushroom themes.

---

## Configuration

All options mirror the [Template Card](./template.md); refer to that document for the full option
reference. Every field that accepts templating in the Template Card works the same way here.

---

## Theming

Because this card is built on the same base element as the legacy template card, overrides such as
`--mush-spacing`, `--mush-card-primary-font-size`, `--mush-icon-border-radius`, and custom `--icon-color`
values will cascade automatically. You can still target the card directly with `style:` overrides to set
additional CSS variables or tweak spacing for a single instance if needed.

---

## Example YAML

```yaml
type: custom:mushroom-diy-template-card
entity: light.living_room_floor_lamp
primary: "{{ states(entity) }}"
secondary: "Brightness: {{ state_attr(entity, 'brightness') | default(0) }}%"
color: "{{ '#FF9800' if is_state(entity, 'on') else 'disabled' }}"
icon_tap_action:
  action: toggle
features:
  - type: target-temperature
    entity: climate.living_room
```
