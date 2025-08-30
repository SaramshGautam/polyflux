import {
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
} from "tldraw";

// Use the correct shape type name that matches your AudioShapeUtil
const versions = createShapePropsMigrationIds("audio", {
  AddAudioProperties: 1,
});

export const audioShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: versions.AddAudioProperties,
      // id: versions,
      // id: "com.tldraw.shape.audio.AddAudioProperties",
      up(props) {
        // Add default properties if they don't exist
        if (props.isPlaying === undefined) props.isPlaying = false;
        if (props.currentTime === undefined) props.currentTime = 0;
        if (props.duration === undefined) props.duration = 0;
        if (props.title === undefined) props.title = "Audio";
        return props;
      },
      down(props) {
        // Remove the properties we added
        delete props.isPlaying;
        delete props.currentTime;
        delete props.duration;
        delete props.title;
        return props;
      },
    },
  ],
});
console.log(
  "AudioShapeMigration: Adding audio properties",
  versions.AddAudioProperties
);
