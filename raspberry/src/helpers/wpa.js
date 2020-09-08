import events from 'events'

import * as config from '../../config'

import cp from 'child_process'
import fs from 'fs'
import _ from 'lodash'

import { sleep } from '../helpers/sleep'

const eventEmitter = new events.EventEmitter()
let status = null


/**
 * Set wpa_supplicant.conf file with countryCode, ssid and password
 * @param {Object} params - Object of params
 * @param {String} params.countryCode A country code based on alpha-2
 * @param {String} params.ssid A SSID of the wifi network
 * @param {String} params.password A password of the SSID
 */
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


/**
 * Start wpa_supplicant and force to return logs to logsys
 */
const _startWpaSupplicant = () => {
  try {
    cp.execSync(`sudo wpa_supplicant -B -i${config.IFFACE_CLIENT} -c /etc/wpa_supplicant/wpa_supplicant.conf -s`)
  } catch (err) {}

  setStatus(null)
}


/**
 * If theres a wpa_supplicant being executed it will kill it.
 */
const _killWpaSupplicant = () => {
  try {
    cp.execSync(`sudo killall wpa_supplicant`)
  } catch (err) {}
}

/**
 * Try to connect to an specified ssid with the file wpa_supplicant.conf
 * @param {Boolean} hasRetried - if is false the connect function will retry to connect after a failed or retry status.
 */
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

/**
 * Disconnect wpa_supplicant
 */
export const disconnect = async () => {
  return cp.execSync(`sudo wpa_cli -i ${config.IFFACE_CLIENT} DISCONNECT`)
}


/**
 * Get wpa_supplicant status
 * @return {String} an enum of status [failed, connected, disconnected, retry]
 */
export const getStatus = () => status

export const setStatus = _.debounce(_status => {
  const oldStatus = getStatus()

  status = _status

  if (oldStatus !== status) {
    eventEmitter.emit('changed-status', status)
  }
})


/**
 * Since wpa_supplicant doesn't return the status of the connection or even erros when it occurs
 * we tail the log and try to get the status from there.
 */
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
