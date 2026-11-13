# Studio board for "Game1"

A shared whiteboard the user sees in the Board panel of Claude Studio. Use it to plan and explain
concepts with the user: draw, write, add images, and look at what the user drew.

## See the board
- board.png: a picture of the whole board, updated a few seconds after every change. Read it to see it.
- images/: every image on the board as a file (read them to see them).
- scene.json: the exact board (Excalidraw format: "elements" array; images reference images/<fileId>.<ext>).

## Draw on the board
Write add.json in this folder: a JSON array of simple shapes. The board adds them within a few
seconds (when the Board panel is open; otherwise as soon as it is opened) and removes add.json.
Coordinates are in pixels; x grows right, y grows down. Look at board.png and scene.json first to
place things next to what is there.

  [
    { "type": "rectangle", "x": 0, "y": 0, "width": 220, "height": 90, "label": { "text": "Login screen" }, "backgroundColor": "#d0ebff" },
    { "type": "ellipse", "x": 300, "y": 0, "width": 160, "height": 90, "label": { "text": "API" } },
    { "type": "diamond", "x": 520, "y": 0, "width": 160, "height": 110, "label": { "text": "OK?" } },
    { "type": "arrow", "x": 220, "y": 45, "width": 80, "height": 0, "label": { "text": "calls" } },
    { "type": "line", "x": 0, "y": 140, "points": [[0, 0], [400, 0]] },
    { "type": "text", "x": 0, "y": 160, "text": "Notes: anything, several lines\nlike this", "fontSize": 20 },
    { "type": "image", "x": 0, "y": 240, "width": 320, "path": "E:/full/path/to/picture.png" },
    { "type": "frame", "x": -40, "y": -40, "width": 800, "height": 600, "name": "Version 1" }
  ]

Optional on any shape: "strokeColor", "backgroundColor", "fillStyle" ("solid", "hachure"),
"strokeWidth", "strokeStyle" ("dashed"), "roundness": { "type": 3 }, "id" (to refer to it again).
Arrows can connect shapes: "start": { "id": "<shape id>" }, "end": { "id": "<shape id>" }.
To clear the board first, write { "clear": true, "elements": [ ...shapes... ] } instead of an array.

## Change or remove what is there
Edit scene.json directly (keep its format; change "x", "y", "text", colors, or remove elements, or
set "isDeleted": true). The open board reloads it within a few seconds. Do not edit it while
add.json is still waiting.
