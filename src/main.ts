import './style.css'
import { FlightPrototype } from './ui/FlightPrototype.ts'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('The application root could not be found.')
}

const game = new FlightPrototype(app)
game.mount()

window.addEventListener('beforeunload', () => game.destroy())
