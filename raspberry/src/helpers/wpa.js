import events from 'events'

import * as config from '../../config'

import cp from 'child_process'
import fs from 'fs'
import _ from 'lodash'

import { sleep } from '../helpers/sleep'

const eventEmitter = new events.EventEmitter()
let status = null

export const setConfig = async ({ countryCode, ssid, password }) => {
  const fileName = '/etc/wpa_supplicant/wpa_supplicant.conf'

  const fileString = fs.readFileSync(fileName).toString()
  const fileArray = fileString.split(/\r|\n/)

  const findNetwork = _.findIndex(fileArray, l => _.includes(l, 'network={'))
  const findCountry = _.findIndex(fileArray, l => _.includes(l, 'country='))
  const findNetworkAfter = _.findIndex(fileArray, l => _.includes(l, '}'))
  const fileEnd = (findNetwork !== -1) ? _.map(fileArray, (d, i) => {
    if (i === findCountry) return ''
    if (i >= findNetwork && i <= findNetworkAfter) {
      return ''
    }
    return d
  }) : fileArray

  const result = fileEnd.join('\n').trim() + (`

  country=${countryCode}

  network={
      ssid=${JSON.stringify(ssid)}
      ${password ? `psk=${JSON.stringify(password)}` : ''}
  }
  `)

  fs.writeFileSync(fileName, result)
}

const _startWpaSupplicant = () => {
  console.log('START WPA')
  try {
    cp.execSync(`sudo wpa_supplicant -B -i${config.IFFACE_CLIENT} -c /etc/wpa_supplicant/wpa_supplicant.conf -s`)
  } catch (err) {}

  setStatus(null)
}

const _killWpaSupplicant = () => {
  try {
    cp.execSync(`sudo killall wpa_supplicant`)
  } catch (err) {}
}

export const connect = (hasRetried = false) => {
  return new Promise((resolve, reject) => {
    _killWpaSupplicant()
    _startWpaSupplicant()

    const statusesControl = status => {
      if (status === 'failed' || status === 'retry') {
        if (hasRetried) return forceRejection()
        resolve(sleep(2000).then(() => connect(true)))
      } else {
        resolve({ status })
      }
    }

    const forceRejection = () => {
      reject(new Error('FAILED_TO_START_WPA_SUPPLICANT'))
    }

    eventEmitter.once('changed-status', statusesControl)
  })
}

export const disconnect = async () => {
  return cp.execSync(`sudo wpa_cli -i ${config.IFFACE_CLIENT} DISCONNECT`)
}

export const getStatus = () => status

export const setStatus = _.debounce(_status => {
  const oldStatus = getStatus()

  status = _status

  if (oldStatus !== status) {
    eventEmitter.emit('changed-status', status)
  }
})

const watchLogs = () => {
  const tail = cp.spawn('tail', ['-f', '/var/log/syslog'])

	tail.stdout.on('data', function(data) {
    const str = data.toString()


    if (str.includes('wpa_supplicant')) {
      if (str.includes('Failed to')) setStatus('failed')
      if (str.includes('CTRL-EVENT-CONNECTED')) setStatus('connected')
      if (str.includes('reason=CONN_FAILED') || str.includes('CTRL-EVENT-DISCONNECTED')) setStatus('disconnected')
      if (str.includes('CTRL-EVENT-REGDOM-CHANGE')) setStatus('retry')
    }
  })

	tail.on('exit', function() {
		watchLogs()
	});
}

watchLogs()
