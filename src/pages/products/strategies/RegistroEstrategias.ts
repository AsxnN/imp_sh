import type { ModoManejoCodigo } from '../types'
import type { EstrategiaManejo } from './EstrategiaManejo'
import { paletizadoStrategy, porCajaStrategy } from './PaletizadoStrategy'
import { serializadoStrategy } from './SerializadoStrategy'

export class RegistroEstrategias {
  private estrategias: Map<string, EstrategiaManejo<any>> = new Map()

  constructor() {
    this.registrar(paletizadoStrategy)
    this.registrar(porCajaStrategy)
    this.registrar(serializadoStrategy)
  }

  registrar(estrategia: EstrategiaManejo<any>): void {
    this.estrategias.set(estrategia.codigoModo.toUpperCase(), estrategia)
  }

  obtener(codigoModo?: ModoManejoCodigo | null): EstrategiaManejo<any> {
    if (!codigoModo) {
      return paletizadoStrategy
    }
    const estrategia = this.estrategias.get(codigoModo.toUpperCase())
    return estrategia || paletizadoStrategy
  }

  listar(): EstrategiaManejo<any>[] {
    return Array.from(this.estrategias.values())
  }
}

export const registroEstrategias = new RegistroEstrategias()

export function getEstrategiaManejo(codigoModo?: ModoManejoCodigo | null): EstrategiaManejo<any> {
  return registroEstrategias.obtener(codigoModo)
}
