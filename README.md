# CoCreate-aria

Orchestrate dynamic UI behavior and ARIA state with event-driven action chains, configured via HTML5 attributes or the JavaScript API. Take it for a spin in our [playground!](https://cocreate.app/docs/aria)

![minified](https://img.badgesize.io/https://cdn.cocreate.app/aria/latest/CoCreate-aria.min.js?style=flat-square&label=minified&color=orange)
![gzip](https://img.badgesize.io/https://cdn.cocreate.app/aria/latest/CoCreate-aria.min.js?compression=gzip&style=flat-square&label=gzip&color=yellow)
![brotli](https://img.badgesize.io/https://cdn.cocreate.app/aria/latest/CoCreate-aria.min.js?compression=brotli&style=flat-square&label=brotli)
![GitHub latest release](https://img.shields.io/github/v/release/CoCreate-app/CoCreate-action?style=flat-square)
![License](https://img.shields.io/github/license/CoCreate-app/CoCreate-action?style=flat-square)
![Hiring](https://img.shields.io/static/v1?style=flat-square&label=&message=Hiring&color=blueviolet)

![CoCreate-aria](https://cdn.cocreate.app/docs/CoCreate-aria.gif)

## [Docs & Demo](https://cocreate.app/docs/aria)

For a complete guide and working demo refer to the [doumentation](https://cocreate.app/docs/aria)

## CDN

```html
<script src="https://cdn.cocreate.app/aria/latest/CoCreate-aria.min.js"></script>
```

```html
<script src="https://cdn.cocreate.app/aria/latest/CoCreate-aria.min.css"></script>
```

## NPM

```shell
$ npm i @cocreate/aria
```

## yarn

```shell
$ yarn install @cocreate/aria
```

# Table of Contents

-   [Table of Contents](#table-of-contents)
-   [Announcements](#announcements)
-   [Roadmap](#roadmap)
-   [How to Contribute](#how-to-contribute)
-   [About](#about)
-   [License](#license)

<a name="announcements"></a>

# Announcements

All updates to this library are documented in our [CHANGELOG](https://github.com/CoCreate-app/CoCreate-aria/blob/master/CHANGELOG.md) and [releases](https://github.com/CoCreate-app/CoCreate-aria/releases). You may also subscribe to email for releases and breaking changes.

<a name="roadmap"></a>

# Roadmap

If you are interested in the future direction of this project, please take a look at our open [issues](https://github.com/CoCreate-app/CoCreate-aria/issues) and [pull requests](https://github.com/CoCreate-app/CoCreate-aria/pulls). We would love to hear your feedback.

<a name="about"></a>

# About

CoCreate-aria is guided and supported by the CoCreate Developer Experience Team.

Please Email the Developer Experience Team [here](mailto:develop@cocreate.app) in case of any queries.

CoCreate-aria is maintained and funded by CoCreate. The names and logos for CoCreate are trademarks of CoCreate, LLC.

<a name="contribute"></a>

# How to Contribute

We encourage contribution to our libraries (you might even score some nifty swag), please see our [CONTRIBUTING](https://github.com/CoCreate-app/CoCreate-aria/blob/master/CONTRIBUTING.md) guide for details.

We want this library to be community-driven, and CoCreate led. We need your help to realize this goal. To help make sure we are building the right things in the right order, we ask that you create [issues](https://github.com/CoCreate-app/CoCreate-aria/issues) and [pull requests](https://github.com/CoCreate-app/CoCreate-aria/pulls) or merely upvote or comment on existing issues or pull requests.

We appreciate your continued support, thank you!

<a name="license"></a>

# License

[The MIT License (MIT)](https://github.com/CoCreate-app/CoCreate-aria/blob/master/LICENSE)

## Toggle buttons and selection groups

Use `aria-pressed` on a button for an independent toggle. Related toggles can
sit inside `role="group"`; grouping does not make them mutually exclusive.

```html
<div role="group" aria-label="Text formatting">
    <button type="button" aria-pressed="false">Bold</button>
    <button type="button" aria-pressed="false">Italic</button>
</div>
```

For one selected option, use custom radios inside a labelled `radiogroup`.
These controls do not need `aria-controls` or a panel to display.

```html
<div role="radiogroup" aria-label="API category">
    <button type="button" role="radio" aria-checked="true">All</button>
    <button type="button" role="radio" aria-checked="false">Storage</button>
    <button type="button" role="radio" aria-checked="false">Cloud</button>
</div>
```

Activating a radio selects it and deselects its siblings. Arrow keys move and
select, Home/End jump to the first/last available item, and Space/Enter activate.
Inside a toolbar, arrow keys move focus without selecting. Nested radio groups
are independent. Disabled and hidden items are skipped during group navigation.

Custom `role="checkbox"` and `role="switch"` controls toggle `aria-checked`.
Native checkbox and radio inputs retain native behavior. Toggle and custom
checked controls synchronize their `active` class with the state attribute;
external attribute changes and dynamically inserted controls are supported.
An initial `mixed` state is preserved until activation, which selects `true`.

Controls handled by this module block activation when disabled or when
`aria-disabled="true"`. Existing tab panel behavior continues to use
`aria-selected` with its `tablist` and `aria-controls` targets.

CoCreate links selection controls that reference the same `aria-controls` target.
Clicking a custom radio clears linked pressed/checked controls; activating a
linked toggle clears the radios while preserving other toggles. Mark a radio
with `aria-default="true"` (or an empty `aria-default`) to select it when the
last toggle is cleared. Without a default, all controls may remain unselected.
`aria-default="false"` disables fallback; disabled radios are not eligible.
If multiple eligible defaults are declared, no fallback is selected.
`aria-checked` describes current selection independently of this default.
`aria-default` is a CoCreate extension, not a standard ARIA attribute.
This is CoCreate behavior, not native ARIA grouping. Tabs and disclosure
controls remain separate, and the target's visibility is unchanged.

Use `aria-default="next"` for a moving default. Its initial radio is the
starting fallback. Selecting another radio sharing the controlled target
removes the marker from the previous radio and places it on the selected one.
"Next" means the next radio selected by the user, including keyboard activation,
not the next radio in DOM order. Pressed buttons and checked toggles never
receive or move this marker. Clearing the last toggle returns to the radio
currently carrying it. A fixed `aria-default="true"` does not move.
Declare one default per linked set; use either a fixed or a moving default.
The marker lives in DOM attributes and is not automatically persisted across
reloads. Direct changes to `aria-checked` do not transfer it.

```html
<div role="group" aria-label="Results mode">
    <div role="radiogroup" aria-label="Preset">
        <button role="radio" aria-checked="true" aria-controls="results" aria-default="next">All</button>
        <button role="radio" aria-checked="false" aria-controls="results">Recommended</button>
    </div>
    <button aria-pressed="false" aria-controls="results">Storage</button>
    <button aria-pressed="false" aria-controls="results">Cloud</button>
</div>
<div id="results"></div>
```

Native `input[type="radio"]` and `input[type="checkbox"]` with `aria-controls`
also participate in linked selection and fixed/moving defaults. They use their
native `checked` property and keyboard behavior, without redundant `aria-checked`
or `aria-pressed` attributes. When coordination changes another native input,
CoCreate dispatches `input` and `change` after the linked values are updated;
unselected radios do not dispatch these notifications.
