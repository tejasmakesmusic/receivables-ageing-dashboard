import { createElement, type ComponentType } from "react";
import "./preview.css";

export const decorators = [
  (Story: ComponentType) =>
    createElement(
      "div",
      {
        className:
          "bg-[var(--color-bg)] p-6 font-sans text-[var(--color-text)]",
      },
      createElement(Story),
    ),
];

export const parameters = {
  a11y: {
    test: "todo",
  },
};
