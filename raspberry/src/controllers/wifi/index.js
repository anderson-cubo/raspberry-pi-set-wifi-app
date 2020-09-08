import * as wifi from '../../services/wifi'
import * as wpa from '../../helpers/wpa'

export const list = async () => {
  return wifi.scan()
}

export const checkConnection = async () => {
  return {
    status: wifi.checkIfIsConnected() ? 'connected' : 'disconnected',
    wpaStatus: wpa.getStatus()
  }
}

export const disable = async () => {
  wifi.disableAccessPoint()

  return { status: 'disabling' }
}

export const connect = async ({ params }) => {
  if (!params.ssid) throw new Error('INVALID_PARAMS')

  const result = await wifi.connect(params.ssid, params.password, params.countryCode)

  return result
}
