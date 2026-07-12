export type CharacterState = 'idle'|'walk'|'sit'|'typing';
export class CharacterSpriteController {
  constructor(public root: HTMLElement, public img: HTMLImageElement, public characterId: string) {}
  setState(state: CharacterState) {
    this.img.src = `01_characters/${this.characterId}/${this.characterId}_${state.toUpperCase()}.png`;
    this.img.dataset.state = state;
    this.root.className = `character character--${state}`;
  }
  setPosition(x:number,y:number){this.root.style.left=`${x*100}%`;this.root.style.top=`${y*100}%`;this.root.style.zIndex=String(Math.round(y*10000));}
}
