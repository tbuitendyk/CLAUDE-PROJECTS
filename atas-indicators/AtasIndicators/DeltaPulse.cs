namespace AtasIndicators;

using System;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;

using ATAS.Indicators;

using MediaColors = System.Windows.Media.Colors;

/// <summary>
/// Starter order-flow indicator. In its own panel it draws each bar's delta (ask volume minus
/// bid volume) as a colored histogram, plus an EMA of delta as a line, and can raise an alert
/// when the live bar's delta reaches a threshold.
/// It is a working base to build on: replace the body of OnCalculate with your own logic;
/// the series, settings and alert plumbing carry over.
/// </summary>
[DisplayName("Delta Pulse")]
[Category(IndicatorCategories.VolumeOrderFlow)]
public class DeltaPulse : Indicator
{
	#region Fields

	private readonly ValueDataSeries _delta = new("Delta", "Delta")
	{
		VisualType = VisualMode.Histogram,
		ShowZeroValue = false
	};

	private readonly ValueDataSeries _average = new("Average", "Average delta")
	{
		VisualType = VisualMode.Line,
		Color = MediaColors.DodgerBlue,
		Width = 2
	};

	private int _period = 14;
	private Color _positiveColor = Color.SeaGreen;
	private Color _negativeColor = Color.IndianRed;
	private int _lastAlertBar = -1;

	#endregion

	#region Properties

	[Display(Name = "Period", GroupName = "Average", Description = "Bars in the EMA of delta.", Order = 10)]
	[Range(1, 1000)]
	public int Period
	{
		get => _period;
		set
		{
			if (value == _period || value < 1)
				return;

			_period = value;
			RecalculateValues();
		}
	}

	[Display(Name = "Positive delta", GroupName = "Colors", Order = 20)]
	public Color PositiveColor
	{
		get => _positiveColor;
		set
		{
			_positiveColor = value;
			RecalculateValues();
		}
	}

	[Display(Name = "Negative delta", GroupName = "Colors", Order = 30)]
	public Color NegativeColor
	{
		get => _negativeColor;
		set
		{
			_negativeColor = value;
			RecalculateValues();
		}
	}

	[Display(Name = "Enabled", GroupName = "Alert", Order = 40)]
	public bool UseAlert { get; set; }

	[Display(Name = "Delta threshold", GroupName = "Alert", Description = "Alert once per bar when the live bar's absolute delta reaches this value.", Order = 50)]
	[Range(0, 100_000_000)]
	public decimal AlertThreshold { get; set; } = 500;

	[Display(Name = "Sound file", GroupName = "Alert", Order = 60)]
	public string AlertFile { get; set; } = "alert1";

	#endregion

	#region ctor

	public DeltaPulse()
		: base(true)
	{
		Panel = IndicatorDataProvider.NewPanel;

		DataSeries[0] = _delta;
		DataSeries.Add(_average);
	}

	#endregion

	#region Protected methods

	protected override void OnCalculate(int bar, decimal value)
	{
		var delta = GetCandle(bar).Delta;

		_delta[bar] = delta;
		_delta.Colors[bar] = delta >= 0 ? _positiveColor : _negativeColor;

		// OnCalculate runs again on every tick of the live bar, so read only finished bars
		// (bar - 1) and overwrite this bar's value each time; never accumulate in a field.
		var k = 2m / (_period + 1);
		_average[bar] = bar == 0 ? delta : delta * k + (1 - k) * _average[bar - 1];

		if (!UseAlert || bar != CurrentBar - 1 || bar == _lastAlertBar || Math.Abs(delta) < AlertThreshold)
			return;

		_lastAlertBar = bar;
		AddAlert(AlertFile, $"{InstrumentInfo.Instrument}: delta {delta:+#,0;-#,0} on the current bar");
	}

	#endregion
}
