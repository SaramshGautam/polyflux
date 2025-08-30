import { StateNode, createShapeId } from "tldraw";

export class MicrophoneTool extends StateNode {
  static id = "microphone";
  static initial = "idle";

  onPointerDown = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      console.log("Audio recording finished:", url);

      const point = this.editor.inputs.currentPagePoint;
      const shapeId = createShapeId();

      this.editor.createShape({
        id: shapeId,
        type: "embed",
        props: {
          w: 300,
          h: 80,
          url: url,
        },
        x: point.x,
        y: point.y,
      });

      stream.getTracks().forEach((track) => track.stop());
    };

    recorder.start();

    // Record for 3 seconds
    setTimeout(() => recorder.stop(), 3000);
    this.editor.setCurrentTool("select");
  };
}

// export const MicrophoneTool = {
//   id: "microphone",
//   initial: "idle",

//   onPointerDown: async (editor) => {
//     const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//     const recorder = new MediaRecorder(stream);
//     const chunks = [];

//     recorder.ondataavailable = (e) => chunks.push(e.data);

//     recorder.onstop = () => {
//       const blob = new Blob(chunks, { type: "audio/webm" });
//       const url = URL.createObjectURL(blob);

//       const point = editor.inputs.currentPagePoint;
//       editor.createShape({
//         id: `audio:${Date.now()}`,
//         type: "audio",
//         x: point.x,
//         y: point.y,
//         props: { audioUrl: url },
//       });

//       stream.getTracks().forEach((track) => track.stop());
//     };

//     recorder.start();

//     // Record for 3 seconds
//     setTimeout(() => recorder.stop(), 3000);
//     editor.setCurrentTool("select");
//   },
// };
