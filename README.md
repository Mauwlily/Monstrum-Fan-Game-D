roadmap

Done:
0.1.0.1
-> Security MD, License MD. Mainly to make that Reddit github-repo security-check bot happy
-> Is not, and will not be its own release

0.1.1
-> Environmental drag smears, bootprints and splatter, hinting there was a crew once, but the Brute got to them
-> Clicking the smiley face three times on the menu unlocks dev mode. You can change actual internal numbers of the Brute, and the debug button unlocks (which is now hidden by default)
-> You no longer get stuck on doors, they smoothly push you past center. And slightly larger reach. Much more reliably to shut them close during chases
-> And the Brute will have a new step sound, that is more intimidating
-> F11 support (added in the compilation stage)
-> macOS and Windows (prior release was just Windows)

0.1.2
-> Repairing an escape route is now louder
-> The monster only updates its escape route bias when it actually spots it
-> You can now peek through stairs, allowing for a limited view of the deck it leads to
-> F11 support (directly in typescript)
-> A new Extreme difficulty. You can enable it per individual setting (by clicking High three times. Reverts when you click high again or a different difficulty), or for all three at once by clicking the Nightmare preset thrice.
-> Reduce chance of Brute getting stuck
-> Scale smoothly with window resolution


Next versions:
0.2.0
-> 4.5x larger ship (1.5x more floors, 2x longer, 1.5x wider)
-> More room types!
-> Steam hazards are now along narrow corridors, and are a directional burst. Found in Deck 1
-> 3 floors (Up from 2). The lower the floor, the more maze-like it becomes, but with major recognizable rooms.
-> New escape route: Submarine
-> Submarine is Deck 1 ; Liferaft is Deck 2 ; Helicopter is Deck 3
-> Reduce stair count to 3 per deck
-> Increase monster senses slightly for all difficulty levels to compensate

0.2.1
-> Master switch on a per-deck basis. Enable it, and any room switches cannot be enabled or disabled, lights are permanently on.
-> Redoing the graphics of all the objects (Ship done, brute done, escape routes done, player done - In prior updates. But objects not yet)

0.3.0
-> Unified Three.js + WebGPU rendering (TSL + Node-based materials/post-processing)
-> Two modes: Top-down 2.5D, First-Person 3D, not allowed to switch mid-game
-> HDR support

0.3.1
-> To fix whatever 0.3.0 will cause

0.4.0
-> Another major upgrade to Brute's AI. With functionality that is enabled for higher intelligence settings
