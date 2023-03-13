AudioClip Updater
=================
Will fix all `AudioClip.play("text", ...)` and convert to the new  `AudioClip.play(self.getResource().getContent("text"), ...)` format. If you have code of the form `AudioClip.play("local::resourceId.contentId", ...)` then it won't be fixed! Can either drag the folder onto the button or click it to choose the project folder.

*After selecting, this modifies your project directory!! Be sure to back it up first!*