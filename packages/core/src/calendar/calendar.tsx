import { ITouchEvent, ScrollView, View } from "@tarojs/components"
import { ViewProps } from "@tarojs/components/types/View"
import { nextTick } from "@tarojs/taro"
import * as classNames from "classnames"
import * as _ from "lodash"
import * as React from "react"
import {
  Children,
  isValidElement,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import useMounted from "../hooks/use-mounted"
import { prefixClassname } from "../styles"
import { getRect } from "../utils/dom/rect"
import { getScrollTop } from "../utils/dom/scroll"
import { useRefs } from "../utils/state"
import CalendarFooter from "./calendar-footer"
import CalendarHeader from "./calendar-header"
import CalendarMonth, { CalendarMonthInstance } from "./calendar-month"
import CalendarContext from "./calendar.context"
import {
  CalendarDayObject,
  CalendarType,
  CalendarValueType,
  compareDate,
  compareYearMonth,
  createNextDay,
  createPreviousDay,
  createToday,
  MAX_DATE,
  MIN_DATE,
} from "./calendar.shared"

type CalendarSubtitleRender = (date: Date) => ReactNode

function defaultSubtitleRender(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function useSubtitleRender(subtitle?: ReactNode | CalendarSubtitleRender): CalendarSubtitleRender {
  const renderRef = useRef<CalendarSubtitleRender>()

  const getRender = useCallback(() => {
    if (_.isBoolean(subtitle) && subtitle) {
      return defaultSubtitleRender
    } else if (_.isBoolean(subtitle) && !subtitle) {
      return () => undefined
    } else if (_.isFunction(subtitle)) {
      return subtitle
    }
    return () => subtitle
  }, [subtitle])

  useEffect(() => {
    renderRef.current = getRender()
  }, [getRender, subtitle])

  return useCallback((date: Date) => renderRef.current?.(date), [])
}

function defaultFormatter(day: CalendarDayObject) {
  return day
}

interface CalendarChildren {
  footer?: ReactNode
}

function useCalendarChildren(children?: ReactNode): CalendarChildren {
  const __children__: CalendarChildren = {}

  Children.forEach(children, (child: ReactNode) => {
    if (isValidElement(child)) {
      const element = child as ReactElement
      const { type: elementType } = element
      if (elementType === CalendarFooter) {
        __children__.footer = element
      }
    }
  })

  return __children__
}

export interface CalendarProps extends ViewProps {
  type?: CalendarType
  title?: ReactNode
  subtitle?: ReactNode | CalendarSubtitleRender
  defaultValue?: CalendarValueType
  value?: CalendarValueType
  min?: Date
  max?: Date
  firstDayOfWeek?: number
  watermark?: boolean
  readonly?: boolean
  children?: ReactNode

  formatter?(day: CalendarDayObject): CalendarDayObject

  onChange?(value: any): void

  onConfirm?(event: ITouchEvent): void
}

function Calendar(props: CalendarProps) {
  const {
    className,
    style,
    title = true,
    subtitle: subtitleProp = true,
    type = "single",
    defaultValue,
    value: currentValue,
    min: minValue = MIN_DATE,
    max: maxValue = MAX_DATE,
    firstDayOfWeek,
    readonly = false,
    watermark = true,
    formatter = defaultFormatter,
    children: childrenProp,
    onChange,
    onConfirm,
  } = props

  const { footer } = useCalendarChildren(childrenProp)

  const bodyRef = useRef()

  const subtitleRender = useSubtitleRender(subtitleProp)

  const changeValueRef = useRef<CalendarValueType>()

  const [subtitle, setSubtitle] = useState<ReactNode>()

  const [bodyScrollTop, setBodyScrollTop] = useState(0)
  const bodyScrollTopRef = useRef(0)
  const [monthRefs, setMonthRefs] = useRefs<CalendarMonthInstance>()

  const dayOffset = useMemo(() => (firstDayOfWeek ? +firstDayOfWeek % 7 : 0), [firstDayOfWeek])

  const limitDateRange = useCallback(
    (date: Date, minDate = minValue, maxDate = maxValue) => {
      if (compareDate(date, minDate) === -1) {
        return minDate
      }
      if (compareDate(date, maxDate) === 1) {
        return maxDate
      }
      return date
    },
    [maxValue, minValue],
  )

  const getInitialDate = useCallback(
    (defaultDate) => {
      if (defaultDate === null) {
        return defaultDate
      }

      const now = createToday()

      if (type === "range") {
        if (!Array.isArray(defaultDate)) {
          defaultDate = []
        }
        const start = limitDateRange(defaultDate[0] || now, minValue, createPreviousDay(maxValue))
        const end = limitDateRange(defaultDate[1] || now, createNextDay(minValue))
        return [start, end]
      }

      if (type === "multiple") {
        if (Array.isArray(defaultDate)) {
          return defaultDate.map((date) => limitDateRange(date))
        }
        return [limitDateRange(now)]
      }

      if (!defaultDate || Array.isArray(defaultDate)) {
        defaultDate = now
      }
      return limitDateRange(defaultDate)
    },
    [limitDateRange, maxValue, minValue, type],
  )

  const months = useMemo<Date[]>(() => {
    const months: Date[] = []
    const cursor = new Date(minValue)

    cursor.setDate(1)

    do {
      months.push(new Date(cursor))
      cursor.setMonth(cursor.getMonth() + 1)
    } while (compareYearMonth(cursor, maxValue) !== 1)

    return months
  }, [maxValue, minValue])

  // get first disabled calendarDay between date range
  const getDisabledDate = (
    disabledDays: CalendarDayObject[],
    startDay: Date,
    date: Date,
  ): Date | undefined =>
    disabledDays.find(
      (day) => compareDate(startDay, day.value!) === -1 && compareDate(day.value!, date) === -1,
    )?.value

  // disabled calendarDay
  const getDisabledDays = () =>
    monthRefs.reduce((arr, ref) => {
      arr.push(...(ref.current?.disabledDays ?? []))
      return arr
    }, [] as CalendarDayObject[])

  const change = useCallback(
    (dateValue: Date | Date[]) => {
      changeValueRef.current = dateValue
      onChange?.(dateValue)
    },
    [onChange],
  )

  const onDayClick = (day: CalendarDayObject) => {
    const { value: date } = day
    if (readonly || !date) {
      return
    }

    if (type === "range") {
      const disabledDays = getDisabledDays()

      if (!currentValue) {
        change([date])
        return
      }

      const [startDay, endDay] = currentValue as [Date, Date]

      if (startDay && !endDay) {
        const compareToStart = compareDate(date, startDay)

        if (compareToStart === 1) {
          const disabledDay = getDisabledDate(disabledDays, startDay, date)

          if (disabledDay) {
            change([startDay, createPreviousDay(disabledDay)])
          } else {
            change([startDay, date])
          }
        } else if (compareToStart === -1) {
          change([date])
        } else {
          change([date, date])
        }
      } else {
        change([date])
      }
    } else if (type === "multiple") {
      if (!currentValue) {
        change([date])
        return
      }
      const dates = currentValue as Date[]

      const newDates = _.filter(dates, (dateItem) => compareDate(dateItem, date) !== 0)
      if (_.size(newDates) !== _.size(dates)) {
        change(newDates)
      } else {
        change([...dates, date])
      }
    } else {
      change(date)
    }
  }

  const onScroll = async () => {
    const top = await getScrollTop(bodyRef)
    const bodyHeight = (await getRect(bodyRef)).height
    const bottom = top + bodyHeight
    const heights = months.map((item, index) => monthRefs[index].current.getHeight())
    const heightSum = heights.reduce((a, b) => a + b, 0)

    // iOS scroll bounce may exceed the range
    if (bottom > heightSum && top > 0) {
      return
    }

    let height = 0
    let currentMonth

    for (let i = 0; i < months.length; i++) {
      const month = monthRefs[i]
      const visible = height <= bottom && height + heights[i] >= top
      if (visible) {
        currentMonth = month
        break
      }
      height += heights[i]
    }
    if (currentMonth) {
      const subtitle = subtitleRender(currentMonth.current.getValue())
      setMonthSubtitle(currentMonth.current, subtitle)
    }
  }

  function setMonthSubtitle(currentMonth: CalendarMonthInstance, subtitle: ReactNode) {
    /* istanbul ignore else */
    if (currentMonth) {
      setSubtitle(subtitle)
    }
  }

  const scrollToDate = async (targetDate?: Date) => {
    months.some((month, index) => {
      if (compareYearMonth(month, targetDate as Date) === 0) {
        const currentMonth = monthRefs[index].current
        const subtitle = subtitleRender(currentMonth.getValue())
        setMonthSubtitle(currentMonth, subtitle)
        nextTick(() => {
          if (bodyRef.current) {
            Promise.all([
              getRect(bodyRef), //
              getScrollTop(bodyRef),
              currentMonth?.getScrollTop(subtitle),
            ]).then(([{ top: bodyTop }, bodyScrollTop, monthScrollTop]) => {
              const newBodyScrollTop = monthScrollTop - bodyTop + bodyScrollTop
              if (bodyScrollTopRef.current !== newBodyScrollTop) {
                setBodyScrollTop(bodyScrollTopRef.current)
                setBodyScrollTop(newBodyScrollTop)
              } else {
                setBodyScrollTop(newBodyScrollTop)
              }
            })
          }
        })

        return true
      }
      return false
    })
  }

  // scroll to current month
  const scrollIntoView = useCallback(async (newValue?: CalendarValueType) => {
    if (newValue) {
      const targetDate = (() => {
        if (type === "single" && _.isDate(newValue)) {
          return newValue as Date
        } else if (_.isArray(newValue)) {
          return newValue[0] as Date
        }
      })()
      await scrollToDate(targetDate)
    } else {
      await onScroll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = (date?: CalendarValueType) => nextTick(() => scrollIntoView(date).then())

  const init = () => reset(currentValue ?? defaultValue)

  useEffect(() => {
    if (currentValue !== changeValueRef.current) {
      reset(getInitialDate(currentValue))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue])

  useEffect(() => {
    reset(getInitialDate(currentValue ?? defaultValue))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, subtitleRender, minValue, maxValue])

  useMounted(init)

  const monthsRender = useMemo(() => {
    return _.map(months, (month, index) => (
      <CalendarMonth
        ref={setMonthRefs(index)}
        key={month.getTime()}
        value={month}
        top={index === 0}
        watermark={watermark}
      />
    ))
  }, [months, setMonthRefs, watermark])

  return (
    <CalendarContext.Provider
      value={{
        type,
        subtitle,
        firstDayOfWeek: dayOffset,
        min: minValue,
        max: maxValue,
        value: currentValue,
        formatter,
        onDayClick,
        onConfirm,
      }}
    >
      <View
        className={classNames(
          prefixClassname("calendar"),
          prefixClassname(`calendar--${type}`),
          className,
        )}
        style={style}
      >
        {(title || subtitle) && <CalendarHeader title={title} subtitle={subtitle} />}
        <ScrollView
          ref={bodyRef}
          className={prefixClassname("calendar__body")}
          scrollY
          scrollTop={bodyScrollTop}
          onScroll={async ({ detail }) => {
            bodyScrollTopRef.current = detail.scrollTop
            await onScroll()
          }}
        >
          {monthsRender}
        </ScrollView>
        {footer}
      </View>
    </CalendarContext.Provider>
  )
}

export default Calendar
