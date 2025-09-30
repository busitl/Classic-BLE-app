import { PermissionsAndroid, Platform } from 'react-native';

/**
 * 请求蓝牙相关权限。
 * 
 * 该函数会根据 Android 版本，请求不同的权限：
 * - Android 31 及以上版本：请求 `BLUETOOTH_SCAN` 和 `BLUETOOTH_CONNECT` 权限。
 * - Android 23 及以上版本（低于 31）：请求 `ACCESS_FINE_LOCATION` 权限。
 * 
 * @returns {Promise<boolean>} 如果所有权限都被授予，返回 true；否则返回 false。
 */
const requestPermissions = async () => {
  // 检查当前平台是否为 Android
  if (Platform.OS === 'android') {
    // 检查 Android 版本是否大于等于 31
    if (Platform.Version >= 31) {
      // 请求 `BLUETOOTH_SCAN` 和 `BLUETOOTH_CONNECT` 权限
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      // 检查权限请求结果
      if (result && result['android.permission.BLUETOOTH_SCAN'] === 'granted' && result['android.permission.BLUETOOTH_CONNECT'] === 'granted') {
        console.debug(
          '[handleAndroidPermissions] User accepts runtime permissions android 12+',
        );
        return true;
      } else {
        console.error(
          '[handleAndroidPermissions] User refuses runtime permissions android 12+',
        );
        return false;
      }
    } else if (Platform.Version >= 23) { // 检查 Android 版本是否大于等于 23
      // 请求 `ACCESS_FINE_LOCATION` 权限
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      // 检查权限请求结果
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        console.debug(
          '[handleAndroidPermissions] User accepts runtime permission android <12',
        );
        return true;
      } else {
        console.error(
          '[handleAndroidPermissions] User refuses runtime permission android <12',
        );
        return false;
      }
    }
  }
  // 非 Android 平台默认返回 true
  return true;
};

// 导出权限请求函数
export default requestPermissions;
