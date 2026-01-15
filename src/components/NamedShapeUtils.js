import React from "react";
import { NoteShapeUtil, TextShapeUtil, ImageShapeUtil } from "tldraw";
import { WithNameTag } from "./WithNameTag";

export function createNamedShapeUtils({ getActorLabelForShape }) {
  const getName = (shape) =>
    getActorLabelForShape?.(shape.id) ||
    shape?.meta?.createdByName ||
    shape?.meta?.createdBy ||
    "Unknown";

  class NamedNote extends NoteShapeUtil {
    static type = "note";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  class NamedText extends TextShapeUtil {
    static type = "text";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  class NamedImage extends ImageShapeUtil {
    static type = "image";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="inside-bottom"
        />
      );
    }
  }

  return { NamedNote, NamedText, NamedImage };
}
