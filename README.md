roadmap

The intial public releases:
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

Big ship, and refinements:
0.2.0
-> 4.5x larger ship (1.5x more floors, 2x longer, 1.5x wider)
-> More room types!
-> Steam hazards are now along narrow corridors, and are a directional burst. Found in Deck 1
-> 3 floors (Up from 2). The lower the floor, the more maze-like it becomes, but with major recognizable rooms.
-> New escape route: Submarine
-> Submarine is Deck 1 ; Liferaft is Deck 2 ; Helicopter is Deck 3 -> Reduce stair count to 3 per deck
-> Increase monster senses slightly for all difficulty levels to compensate

0.2.1
-> Deck 2 is now guaranteed to have two long hallways, and has more 2-wide sub-hallways. Deck 1 meanwhile is about 1-wide claustrophobia
-> Hallways are no longer "fleshy", meaning they form clean L, tri-way, four-way shapes without fusing in weird organic ways
-> Deck 1 hallways are split up by watertight doors that are louder and slower to open.
-> After greedy generation is finished, and before item spawning, two-to-three rooms in deck 2 and 1 are replaced by hallways
-> More non-interactable environmental furniture 
-> Procedural generation bug is fixed where rooms randomly have a hole in the wall
-> Rooms now have more entry points on average

0.2.2
(human changes)
-> Slightly larger radius when peeking into stairs
-> Repairs are louder yet-again to compensate for larger ship size
-> Zoom goes from 2.5x to 1x, instead of 1.8x to 0.9x
(ai changes)
-> Peeking outside a hiding spot when room light is on does not drain flashlight battery, nor does it alert the monster
-> Door peeking changes: Drains battery now. Low Int monster ignores the beam. Med Int monster treats it as a clue. High Int monster charges through the door.
-> New main menu, meant to look visually closer to Monstrum

0.2.3
-> Door peeking also doesn't alert or drain if the light is active on the side you are peeking into
-> One master fuse spawns in the map
-> When you insert it (the slot is in its dedicated room), the deck's lights are permanently on. Including the hallways! (Which are normally always dark)
-> Lower intelligence monsters go to the nearest lightswitch (10s for Low, 3s for Med) to try to turn it off repeatedly for a while. high intelligence monsters do it better (High requires just 1 lightswitch click to know ; Extreme finally has something over High, where the Brute realises only the master fuse is able to turn on hallways light, so it continues as if nothing happened)
-> Low intelligence sometimes even forgets lightswitches don't do anything with the master fuse inserted, and tries to click one for a bit again. Med and above don't, and will ignore all lightswitches for that deck.
-> Bolt cutters now make sense. The helicopter is chained by default, 6 chains. You have to cut each chain (takes 2 seconds per, plus a loud noise once they snap). And there now are rooms that only have locked doors, meaning you require the cutter to open them. Brute is guaranteed to not spawn in those rooms

The 3D series:
0.3.0
-> Unified Three.js + WebGPU rendering (TSL + Node-based materials/post-processing)
-> Graphically conservative for this version, mostly to get the renderer there

0.3.1
-> 3D assets, with 2D internal logic kept
-> Generally a plethora of graphical improvements
-> Graphics settings
-> HDR support

0.3.2
-> Two modes: Top-down, First-Person, not allowed to switch mid-game
-> Decks (other than Deck 3) have ceilings in First-Person mode
-> Even though internal logic is 2D, we can force objects to only be clickable if three.js determines them to be, meaning we get a verticality enhancements for these interactions

Brutey-balls get more brainz (details are rough for now):
0.4.0 -> Search overhaul
0.4.1 -> Chase overhaul
0.4.2 -> Stalk/Investigate overhaul
